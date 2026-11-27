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
  { id: 'sink', label: '水槽' },
  { id: 'other', label: '其它' },
];

const ID_RE = /^[a-z0-9][a-z0-9-]{2,40}$/u;
const FILE_RE = /^[A-Za-z0-9._-]{3,80}\.dshpack$/u;
const SHA_RE = /^[0-9a-f]{64}$/u;
const MAX_BYTES = 64 * 1024 * 1024;

// 体量词条：按包里插件总数自动判定（0-3 轻量 / 4-8 中型 / 9-12 大型 / 13+ 大宗）
function tierOf(count) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  if (n >= 13) return 'huge';
  if (n >= 9) return 'large';
  if (n >= 4) return 'medium';
  return 'small';
}

function fail(problems, where, message) {
  problems.push(where + ': ' + message);
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
    if (!String(description.en || '').trim()) fail(problems, where, '缺少 description.en（上传要双语）');
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
      // 2026-11 起轻量包的插件可以不写死版本：{ "name": "x", "latest": true }
      // 安装时按名字取市场最新版（插件市场认市场版）；写了 version 就必须是 x.y.z。
      const latest = plugin && plugin.latest === true;
      if (!latest) {
        if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(String(plugin.version || ''))) {
          fail(problems, where, '插件 ' + (plugin && plugin.name ? plugin.name : '?') + ' 的 version 不是 x.y.z（要跟市场最新就写 latest: true，不要乱填）');
        }
      } else if (String(plugin.version || '').trim() && !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(String(plugin.version))) {
        fail(problems, where, '插件 ' + String(plugin.name) + ' 标了 latest 又写了非法 version');
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
      updatedAt: String(raw.updatedAt || raw.createdAt || ''),
      description: { zh: String(description.zh || ''), en: String(description.en || '') },
      plugins: plugins.map((plugin) => ({
        name: String(plugin.name).trim(),
        version: String(plugin.version || ''),
        latest: plugin.latest === true,
        description: String(plugin.description || ''),
      })),
      homepage: String(raw.homepage || ''),
      ...(typeof raw.downloads === 'number' ? { downloads: raw.downloads } : {}),
      pluginCount: Array.isArray(raw.plugins) ? raw.plugins.length : 0,
    });
  }

  if (problems.length > 0) {
    console.error('构建失败，' + problems.length + ' 个问题：');
    for (const problem of problems) console.error(' - ' + problem);
    process.exitCode = 1;
    return;
  }

  // 下载量：指的是这个 .dshpack 安装文件本身被下载的次数，不是包里插件的 npm 下载量。
  // 目录只存元数据、不搬文件；Git 仓库里的文件没有逐文件计数，所以作者不写就不输出这个字段
  // （客户端显示「下载量暂无统计」）。将来把包托管到 GitHub Release，条目里写
  // downloads（Release 资产的 download_count），这里会原样透传。
  for (const pack of packs) {
    if (typeof pack.downloads !== 'number' || pack.downloads < 0) delete pack.downloads;
  }

  // 水槽：把包里插件对应到插件市场的分类，跨三类以上就算「什么都有」，统一归到水槽，
  // 不让作者硬塞进某个单一场景。插件市场目录拿不到时跳过（不影响构建）。
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const index = await res.json();
      const categoryByName = new Map();
      for (const item of index.plugins || []) {
        if (item && item.name && item.category) categoryByName.set(item.name, String(item.category));
      }
      for (const pack of packs) {
        const kinds = new Set();
        for (const plugin of pack.plugins || []) {
          const marketCategory = categoryByName.get(plugin.name);
          if (marketCategory) kinds.add(marketCategory);
        }
        if (kinds.size >= 3) {
          pack.category = '水槽';
          pack.categoryAuto = true;
        }
        pack.tier = tierOf(pack.pluginCount);
      }
    }
  } catch {
    // 拿不到目录就保留作者分类，体量照算
  }
  for (const pack of packs) {
    if (!pack.tier) pack.tier = tierOf(pack.pluginCount);
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
