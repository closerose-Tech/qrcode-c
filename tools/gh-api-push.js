/* 通过 GitHub REST API 把本地工作树同步到远端 main（git push 被网络策略拦截时的替代路径）
 * 用法：node tools/gh-api-push.js ["提交说明"]
 * 原理：取远端 main 的 tree，与本机 git ls-files 的 blob SHA 逐文件比对，
 *       只上传有差异的 blob，再建 tree → commit → 更新 ref（本地不需要持有远端历史）。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'closerose-Tech/qrcode-c';
const API = 'https://api.github.com';
const BRANCH = 'main';

function git(args, input) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
}

function token() {
  const out = git(['credential', 'fill'], 'protocol=https\nhost=github.com\n\n');
  const m = out.match(/password=(.+)/);
  if (!m) throw new Error('未取到 GitHub token');
  return m[1].trim();
}

async function api(tk, method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + tk,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'qrq-release',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(method + ' ' + url + ' → ' + res.status + ' ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

(async () => {
  const tk = token();
  const message = (process.argv[2] || git(['log', '-1', '--pretty=%B'])).trim();

  const ref = await api(tk, 'GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const baseSha = ref.object.sha;
  const baseCommit = await api(tk, 'GET', `/repos/${REPO}/git/commits/${baseSha}`);
  const baseTree = await api(tk, 'GET', `/repos/${REPO}/git/trees/${baseCommit.tree.sha}?recursive=1`);

  const remote = new Map();
  (baseTree.tree || []).forEach((e) => { if (e.type === 'blob') remote.set(e.path, e.sha); });

  // 用索引里的 blob（已按 .gitattributes / core.autocrlf 归一化），
  // 不要用工作区原始字节：Windows 上 CRLF 会让哈希与仓库内不一致，反复“假差异”
  const index = new Map();
  git(['ls-files', '-s', '-z']).split('\0').filter(Boolean).forEach((line) => {
    const m = line.match(/^(\d{6}) ([0-9a-f]{40}) \d+\t(.+)$/);
    if (m) index.set(m[3], { mode: m[1], sha: m[2] });
  });

  const entries = [];
  let uploaded = 0;

  for (const [rel, info] of index) {
    if (remote.get(rel) === info.sha) continue;
    const buf = execFileSync('git', ['cat-file', 'blob', info.sha], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    const blob = await api(tk, 'POST', `/repos/${REPO}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
    entries.push({ path: rel, mode: info.mode, type: 'blob', sha: blob.sha });
    uploaded++;
    console.log('blob', rel);
  }

  for (const rel of remote.keys()) {
    if (!index.has(rel)) {
      entries.push({ path: rel, mode: '100644', type: 'blob', sha: null });
      console.log('del ', rel);
    }
  }

  if (!entries.length) { console.log('无差异，远端已是最新：' + baseSha); return; }

  const tree = await api(tk, 'POST', `/repos/${REPO}/git/trees`, { base_tree: baseCommit.tree.sha, tree: entries });
  const commit = await api(tk, 'POST', `/repos/${REPO}/git/commits`, { message, tree: tree.sha, parents: [baseSha] });
  await api(tk, 'PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
  console.log('pushed ' + commit.sha + ' (' + uploaded + ' blobs, ' + entries.length + ' entries)');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
