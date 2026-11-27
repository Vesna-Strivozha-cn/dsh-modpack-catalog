import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data', 'packs');
const PACK_DIR = path.join(ROOT, 'packs');
const OUT = path.join(ROOT, 'packs.json');

// 分类先按使用场景划分：够用，又能让浏览页一眼看懂。想加新分类在这里加，
// 条目里用的 category 必须是这里之一（构建会挡）。
export const CATEGORIES = [
  { id: 'work', label: '工作办公' },
  { id: 'perf', label: '性能优化' },
  { id: 'ui', label: '界面美化' },
  { id: 'util', label: '实用功能' },
  { id: 'dev', label: '开发调试' },
  { id: 'fun', label: '娱乐休闲' },
  { id: 'learn', label: '学习资料' },
  { id: 'other', label: '其它' },
];

const ID_RE = /^[a-z0-9][a-z0-9-]{2,40}$/u;
const FILE_RE = /^[A-Za-z0-9._-]{3,80}\.dshpack$/u;
const SHA_RE = /^[0-9a-f]{64}$/u;
const MAX_BYTES = 64 * 1024 * 1024;

function fail(problems, where, message) {
  problems.push(where + ': ' + message);
}

function npmWeekDownloads(name) {
  return fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data && typeof data.downloads === 'number' ? data.downloads : 0))
    .catch(() => 0);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const problems = [];
  const files = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter((name) => name.endsWith('.json')).sort()
    : [];
  const packs = [];
  const seen = new Set();

  for (const file of files) {
    const where = 'data/packs/' + file;
    let raw;
    try {
      raw = readJson(path.join(DATA_DIR, file));
    } catch (error) {
      fail(problems, where, '不是合法 JSON：' + String(error.message || error));
      continue;
    }
    const id = String(raw.id || '').trim();
    if (!ID_RE.test(id)) fail(problems, where, 'id 要是 3~40 位小写字母数字与短横线');
    else if (seen.has(id)) fail(problems, where, 'id 重复：' + id);
    else seen.add(id);
    if (!raw.name || !String(raw.name).trim()) fail(problems, where, '缺少 name（显示名）');
    if (!raw.author || !String(raw.author).trim()) fail(problems, where, '缺少 author');
    const category = CATEGORIES.some((item) => item.label === raw.category) ? raw.category : '';
    if (!category) fail(problems, where, 'category 必须是：' + CATEGORIES.map((c) => c.label).join(' / '));
    const strategy = String(raw.strategy || 'lite');
    if (strategy !== 'lite') fail(problems, where, '现在只收轻量包（strategy: lite）');
    const description = raw.description && typeof raw.description === 'object' ? raw.description : {};
    if (!String(description.zh || '').trim()) fail(problems, where, '缺少 description.zh');
    const fileName = String(raw.file || '').trim();
    if (!FILE_RE.test(fileName)) fail(problems, where, 'file 要指向 packs/ 下的 .dshpack 文件名');
    const sha = String(raw.sha256 || '').trim().toLowerCase();
    if (!SHA_RE.test(sha)) fail(problems, where, '缺少合法的 sha256');
    const declaredSize = Number(raw.size) || 0;
    if (!(declaredSize > 0) || declaredSize > MAX_BYTES) fail(problems, where, 'size 必须是 0~64MB 之间的字节数');
    const plugins = Array.isArray(raw.plugins) ? raw.plugins : [];
    if (plugins.length === 0) fail(problems, where, 'plugins 不能为空（要列出包里装了哪些插件与版本）');
    for (const plugin of plugins) {
      if (!plugin || !String(plugin.name || '').trim()) fail(problems, where, 'plugins 里有条目缺 name');
      if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(String(plugin.version || ''))) {
        fail(problems, where, '插件 ' + (plugin && plugin.name ? plugin.name : '?') + ' 的 version 不是 x.y.z');
      }
    }

    // 包文件在仓库里就当场核对一遍：sha256 与大小必须和声明一致，
    // 免得目录里挂一个「指过去的文件早就被换掉了」的条目。
    const packFile = path.join(PACK_DIR, fileName);
    let size = declaredSize;
    if (fs.existsSync(packFile)) {
      const bytes = fs.readFileSync(packFile);
      const actual = crypto.createHash('sha256').update(bytes).digest('hex');
      size = bytes.length;
      if (actual !== sha) fail(problems, where, '包文件 sha256 与声明不一致（声明 ' + sha.slice(0, 12) + '…，实际 ' + actual.slice(0, 12) + '…）');
      if (bytes.length > MAX_BYTES) fail(problems, where, '包文件超过 64MB');
    }

    packs.push({
      id,
      name: String(raw.name).trim(),
      author: String(raw.author).trim(),
      category,
      version: String(raw.version || '1.0.0'),
      strategy,
      file: fileName,
      sha256: sha,
      size,
      createdAt: String(raw.createdAt || ''),
      description: { zh: String(description.zh || ''), en: String(description.en || '') },
      plugins: plugins.map((plugin) => ({
        name: String(plugin.name).trim(),
        version: String(plugin.version),
        description: String(plugin.description || ''),
      })),
      homepage: String(raw.homepage || ''),
      downloads: typeof raw.downloads === 'number' ? raw.downloads : 0,
    });
  }

  if (problems.length > 0) {
    console.error('构建失败，' + problems.length + ' 个问题：');
    for (const problem of problems) console.error(' - ' + problem);
    process.exitCode = 1;
    return;
  }

  // npm 下载量：把包里各插件的上周下载量加起来展示，单个查不到按 0。
  // 这一步失败不影响构建（只是少个数字），所以全部 catch 到 0。
  for (const pack of packs) {
    if (pack.downloads > 0) continue;
    const counts = await Promise.all(pack.plugins.map((plugin) => npmWeekDownloads(plugin.name)));
    pack.downloads = counts.reduce((sum, value) => sum + value, 0);
  }

  packs.sort((a, b) => a.id.localeCompare(b.id));
  const output = {
    schema: 1,
    builtAt: new Date().toISOString(),
    count: packs.length,
    categories: CATEGORIES.map((category) => ({
      ...category,
      count: packs.filter((pack) => pack.category === category.label).length,
    })),
    packs,
  };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 1) + '\n', 'utf8');
  console.log('packs.json: ' + packs.length + ' 个整合包，' + output.categories.map((c) => c.label + '=' + c.count).join(' '));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
