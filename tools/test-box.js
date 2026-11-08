/*!
 * 盒条二维码合规引擎 · 端到端断言
 * 用合成数据直接驱动 QRQ.Box.analyze，校验指标判定与偏差方向。
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

function ok(cond, msg) {
  if (cond) { pass++; console.log('  OK   ' + msg); }
  else { fail++; console.log('  FAIL ' + msg); }
}

const TEXT = 'YZWM.TOBACCO.CN/690102801/01' + '6900000000017' + '000000000000000001';

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
    ppm: opt.ppm === undefined ? 40 : opt.ppm,
    pack: opt.pack || 'box-std',
    grade: opt.grade || gradeStub({})
  }, { pinggui: PG });
  const get = k => {
    for (const g of r.groups) for (const it of g.items) if (it.key === k) return it;
    return null;
  };
  return { r, get };
}

console.log('\n=== 用例 1：8mm 盒码，标定齐全 ===');
{
  const { r, get } = run('std');
  ok(get('s_size').status === 'ok' && Math.abs(get('s_size').value - 8) < 0.05, '边长 8.0mm 判符合');
  ok(get('s_dpi').status === 'ok', '模块宽 0.28mm 判符合（下限型：越大越好）');
  ok(get('s_square').status === 'ok' && get('s_square').dev < 0, '正方形度 0 判符合（偏差为负是余量）');
  ok(get('s_frame').status === 'na', '全白图底框不可测 → 待标定');
  ok(get('d_type').status === 'ok' && get('d_type').value === '盒码', '命中演示库并判为盒码');
  ok(get('d_name').value === '示例·硬盒（演示）', '带出品规名称');
  ok(r.status === 'ok', '总体结论为符合');
  ok(!!r.verdict.headline && /符合/.test(r.verdict.headline), '结论文案含“符合”');
}

console.log('\n=== 用例 2：二维码 11.2mm，超出盒-标准支/中支上限 ===');
{
  const { get } = run('big', { quad: quadOf(448, 400, 400) });
  ok(get('s_size').status === 'fail', '边长 11.2mm 判超差');
  ok(Math.abs(get('s_size').dev - 1.2) < 0.01, '偏差 +1.2mm（对上限 10mm）');
}

console.log('\n=== 用例 3：6.4mm 盒烟，低于下限 ===');
{
  const { get } = run('small', { quad: quadOf(256, 400, 400) });
  ok(get('s_size').status === 'fail', '边长 6.4mm 判超差');
  ok(Math.abs(get('s_size').dev + 1.6) < 0.01, '偏差 -1.6mm（对下限 8mm）');
}

console.log('\n=== 用例 4：版本 4，模块数不符 ===');
{
  const { get } = run('v4', { grade: gradeStub({ version: 4, size: 33 }) });
  ok(get('sym_ver').status === 'fail', '版本 4 判超差');
  ok(get('sym_size').status === 'fail', '模块数 33×33 判超差');
}

console.log('\n=== 用例 5：未标定 ===');
{
  const { r, get } = run('noscale', { ppm: null });
  ok(get('s_size').status === 'na' && get('s_size').value === null, '未标定时边长不给臆测值');
  ok(get('s_frame').status === 'na', '未标定时底框为待标定');
  ok(r.counts.fail === 0, '未标定不应产生误判超差');
  ok(r.notes.some(n => /尺寸基准/.test(n)), '提示需要设置尺寸基准');
  ok(r.verdict.details.some(d => /未设置尺寸基准/.test(d)), '结论说明未标定');
}

console.log('\n=== 用例 6：编码长度与字符集 ===');
{
  const { get } = run('len', { grade: gradeStub({ text: TEXT.slice(0, 55) }) });
  ok(get('code_len').status === 'fail', '55 位判超差');
  const g2 = run('chars', { grade: gradeStub({ text: TEXT.replace('/', '#') }) });
  ok(g2.get('code_charset').status === 'fail', '含 # 非法字符判超差');
}

console.log('\n=== 用例 7：条烟 11mm 落在 10~12mm ===');
{
  const { get } = run('case', { quad: quadOf(440, 400, 400), pack: 'case-std' });
  ok(get('s_size').status === 'ok', '11mm 在条烟区间内');
  ok(!!get('s_vcenter'), '条烟额外给出端面垂直居中项');
}

console.log('\n=== 用例 8：规格代码第 8–12 位匹配 ===');
{
  // 表：盒码 13 / 品规名称 / 条码 12 / 规格代码 13
  PG.ingest([
    ['盒码', '品规名称', '条码', '规格代码'],
    ['0080300775105', '中华（硬）', '080300775136', '6901028077510'],
    ['0080300775204', '芙蓉王（硬）', '080300775204', '6901028077527']
  ]);
  const key = '6901028077510'.slice(7, 12);          // 第 8–12 位
  ok(key === '07751', '规格代码第 8–12 位取到 07751');

  // 59 位：第 31–35 位放这个键，其余用数字填充，且不含完整盒码/条码
  const payload = '1'.repeat(30) + key + '2'.repeat(59 - 35);
  const hit = PG.match(payload);
  ok(!!hit && hit.name === '中华（硬）', '按二维码第 31–35 位匹配到品规名称', hit && hit.name);
  ok(!!hit && hit.via === 'spec5' && hit.key5 === key, '命中方式标记为规格代码', hit && hit.via);
  ok(!!hit && hit.spec === '6901028077510', '回带 13 位规格代码', hit && hit.spec);
  ok(!!hit && hit.type === '', '仅凭 5 位无法判定盒/条时给出“盒码 / 条码”');

  // 手动查询 5 位
  const q = PG.query(key);
  ok(!!q && q.name === '中华（硬）', '手动输入 5 位可反查品规');
  // 全码命中优先
  const full = PG.match('9'.repeat(20) + '080300775136' + '9'.repeat(20));
  ok(!!full && full.type === 'bar' && full.name === '中华（硬）', '全码命中仍优先判定条码');

  // 恢复演示库，避免影响后续手工验证
  PG.reset();
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
