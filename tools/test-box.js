/*!
 * 盒条二维码合规引擎 · 端到端断言
 * 用合成数据直接驱动 QRQ.Box.analyze，校验指标判定、偏差方向与盒 / 条归属。
 *   node tools/test-box.js
 */
const path = require('path');
const QRQ = {};
globalThis.QRQ = QRQ;

require('../app/assets/js/core/box.js');
require('../app/assets/js/core/pinggui.js');

const Box = QRQ.Box;
const PG = QRQ.Pinggui;

let pass = 0, fail = 0;

function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  OK   ' + msg); }
  else { fail++; console.log('  FAIL ' + msg + (extra === undefined ? '' : ' → ' + extra)); }
}

/* 59 位：地址 15 + '/' + 前缀 9 + '/' + 实体分类 2 + 属性码 13 + 流水码 18
 * 属性码首位（第 29 位）= 1 判盒码 */
const TEXT = 'YZWM.TOBACCO.CN/690102801/01' + '1900000000017' + '000000000000000001';

/* 合成一张均匀灰图（全白），quad 为正方形 */
function makeGray(n) { return new Uint8Array(n * n).fill(255); }

function quadOf(px, cx, cy) {
  const h = px / 2;
  return [{ x: cx - h, y: cy - h }, { x: cx + h, y: cy - h }, { x: cx + h, y: cy + h }, { x: cx - h, y: cy + h }];
}

function gradeStub(opt) {
  return {
    ok: opt.ok !== false,
    decode: { text: opt.text === undefined ? TEXT : opt.text, version: opt.version || 3, size: opt.size || 29, ecl: opt.ecl || 'M' },
    grade: { value: opt.value === undefined ? 4 : opt.value },
    metrics: opt.metrics || [
      { key: 'SC', name: '符号对比度', value: 91.6, grade: 4, unit: '%' },
      { key: 'MOD', name: '调制度', value: 99.6, grade: 4, unit: '%' },
      { key: 'FPD', name: '固定图形损伤', value: 0, grade: 4, unit: '%' },
      { key: 'ANU', name: '轴向非均匀', value: 0, grade: 4, unit: '%' },
      { key: 'GNU', name: '网格非均匀', value: 8.9, grade: 4, unit: '%' },
      { key: 'UEC', name: '未用纠错', value: 100, grade: 4, unit: '%' }
    ]
  };
}

function run(label, opt) {
  opt = opt || {};
  const gray = makeGray(800);
  const r = Box.analyze(gray, 800, 800, {
    quad: opt.quad || quadOf(320, 400, 400),
    grade: opt.grade || gradeStub({})
  }, { pinggui: PG });
  const get = k => {
    for (const g of r.groups) for (const it of g.items) if (it.key === k) return it;
    return null;
  };
  return { r, get };
}

/* 把 payload 第 n 位（1 起）替换成 ch */
function withDigit(text, n, ch) {
  return text.slice(0, n - 1) + ch + text.slice(n);
}

console.log('\n=== 用例 1：标准盒码，属性码首位为 1 ===');
{
  const { r, get } = run('std');
  ok(get('d_type').status === 'ok' && get('d_type').value === '盒码', '第 29 位 = 1 判为盒码', get('d_type').value);
  ok(get('d_type').std === '第29位 1/2', '标准列注明判据是第 29 位', get('d_type').std);
  ok(/第 29 位为「1」/.test(get('d_type').desc), '说明文字点明第 29 位的取值', get('d_type').desc);
  ok(r.kind && r.kind.type === 'box', '结果对象带 kind=box');
  ok(get('d_name').value === '示例·硬盒（演示）', '带出品规名称', get('d_name').value);
  ok(get('d_name').desc.indexOf('1900000000017') >= 0 && get('d_name').desc.indexOf('2900000000024') >= 0,
    '说明里同时给出盒码与条码', get('d_name').desc);
  ok(r.status === 'ok', '总体结论为符合', r.status);
  ok(!!r.verdict.headline && /符合/.test(r.verdict.headline), '结论文案含“符合”');
  ok(r.verdict.details.some(d => /判定为盒码/.test(d)), '结论说明盒 / 条归属', r.verdict.details.join(' | '));
  ok(r.counts.total === 17, '受检项为 17 项（原尺寸与套印 5 项已移除）', r.counts.total);
  ok(!r.groups.some(g => g.key === 'size'), '不再输出「喷印尺寸与套印」分组');
  ok(['s_size', 's_dpi', 's_square', 's_frame', 's_offset', 's_vcenter'].every(k => !get(k)),
    '尺寸类指标（边长/模块宽/正方形度/底框/位置偏差/垂直居中）全部不再出现');
  ok(!('ppm' in r) && !('pack' in r) && !('geo' in r), '结果对象不再带 ppm / pack / geo');
}

console.log('\n=== 用例 2：属性码首位为 2 → 条码 ===');
{
  const text = withDigit(TEXT, 29, '2');
  const { r, get } = run('bar', { grade: gradeStub({ text }) });
  ok(get('d_type').value === '条码' && get('d_type').status === 'ok', '第 29 位 = 2 判为条码', get('d_type').value);
  ok(r.kind && r.kind.type === 'bar', '结果对象带 kind=bar');
  ok(r.verdict.details.some(d => /判定为条码/.test(d)), '结论说明判为条码');
}

console.log('\n=== 用例 3：属性码首位既非 1 也非 2 ===');
{
  const text = withDigit(TEXT, 29, '6');
  const { r, get } = run('other', { grade: gradeStub({ text }) });
  ok(get('d_type').value === '无法判定', '第 29 位 = 6 时显示无法判定', get('d_type').value);
  ok(get('d_type').status === 'fail', '第 29 位不合规判超差（不误判为符合）', get('d_type').status);
  ok(r.status === 'fail', '整体结论为不符合', r.status);
  ok(r.verdict.details.some(d => /不是 1 或 2/.test(d)), '结论提示需人工确认');
}

console.log('\n=== 用例 4：版本 4，模块数不符 ===');
{
  const { get } = run('v4', { grade: gradeStub({ version: 4, size: 33 }) });
  ok(get('sym_ver').status === 'fail', '版本 4 判超差');
  ok(get('sym_size').status === 'fail', '模块数 33×33 判超差');
}

console.log('\n=== 用例 5：未识读 ===');
{
  const { r, get } = run('noread', { grade: { ok: false, decode: { text: '' }, grade: null, metrics: null } });
  ok(get('d_type').status === 'na' && get('d_type').value === null, '未识读时归属为不适用');
  ok(r.kind === null, '未识读时 kind 为空');
  ok(get('sym_qr').status === 'fail', '码制项判超差');
  ok(r.counts.fail > 0, '未识读不给出“全部符合”');
}

console.log('\n=== 用例 6：编码长度与字符集 ===');
{
  const { get } = run('len', { grade: gradeStub({ text: TEXT.slice(0, 55) }) });
  ok(get('code_len').status === 'fail', '55 位判超差');
  const g2 = run('chars', { grade: gradeStub({ text: TEXT.replace('/', '#') }) });
  ok(g2.get('code_charset').status === 'fail', '含 # 非法字符判超差');
}

console.log('\n=== 用例 7：符号质量偏低 ===');
{
  const { get } = run('low', { grade: gradeStub({ value: 1.1 }) });
  ok(get('q_grade').status === 'fail', '综合等级 1.1 判超差');
  ok(/不低于 1\.5|1\.5/.test(get('q_grade').desc), '说明引用 1.5 门槛');
}

console.log('\n=== 用例 8：规格代码第 8–12 位匹配 ===');
{
  // 表：盒码 13 / 品规名称 / 条码 13 / 规格代码 13
  PG.ingest([
    ['盒码', '品规名称', '条码', '规格代码'],
    ['1080300775105', '中华（硬）', '6901028118194', '6901028077510'],
    ['1080300775204', '芙蓉王（硬）', '6901028118200', '6901028077527']
  ]);
  const key = '6901028077510'.slice(7, 12);          // 第 8–12 位
  ok(key === '07751', '规格代码第 8–12 位取到 07751');

  // 59 位：第 31–35 位放这个键，第 29 位置 1，且不含完整盒码/条码
  const payload = '1'.repeat(30) + key + '2'.repeat(59 - 35);
  const hit = PG.match(payload);
  ok(!!hit && hit.name === '中华（硬）', '按二维码第 31–35 位匹配到品规名称', hit && hit.name);
  ok(!!hit && hit.via === 'spec5' && hit.key5 === key, '命中方式标记为规格代码', hit && hit.via);
  ok(!!hit && hit.spec === '6901028077510', '回带 13 位规格代码', hit && hit.spec);
  ok(!!hit && hit.box === '1080300775105' && hit.bar === '6901028118194', '回带对应的盒码与条码', hit && (hit.box + '/' + hit.bar));

  // 手动查询 5 位
  const q = PG.query(key);
  ok(!!q && q.name === '中华（硬）', '手动输入 5 位可反查品规');
  // 全码命中
  const full = PG.match('9'.repeat(20) + '6901028118194' + '9'.repeat(20));
  ok(!!full && full.type === 'bar' && full.name === '中华（硬）', '13 位条码全码命中判定条码');
  ok(PG.query('6901028118194').name === '中华（硬）', '手动输入 13 位条码可反查品规');

  // 恢复演示库，避免影响后续手工验证
  PG.reset();
}

console.log('\n=== 用例 9：演示库与判定规则自洽 ===');
{
  const s = PG.SAMPLE[0];
  ok(String(s[0]).charAt(0) === '1', '演示库盒码首位为 1，与第 29 位规则一致', s[0]);
  ok(String(s[2]).length === 13, '演示库条码为 13 位', s[2]);
  ok(Box.kindFromPayload(TEXT) && Box.kindFromPayload(TEXT).code === '1', 'kindFromPayload 读取第 29 位');
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
