import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
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

// 从 .dshpack（zip）里取出 dsh-modpack.json —— 条目里不再写介绍、名称、作者、插件，
// 一律以打包时填进包里的清单为准，免得目录和包各说一套。
function readPackManifest(bytes) {
  let eocd = bytes.length - 22;
  while (eocd > 0 && bytes.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd <= 0) throw new Error('不是 zip（找不到中央目录）');
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    const nameLen = bytes.readUInt16LE(offset + 28);
    const extraLen = bytes.readUInt16LE(offset + 30);
    const commentLen = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    if (name === 'dsh-modpack.json') {
      const localOffset = bytes.readUInt32LE(offset + 42);
      const method = bytes.readUInt16LE(offset + 10);
      const csize = bytes.readUInt32LE(offset + 20);
      const localNameLen = bytes.readUInt16LE(localOffset + 26);
      const localExtraLen = bytes.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const raw = bytes.subarray(start, start + csize);
      const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
      return JSON.parse(data.toString('utf8'));
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('包里没有 dsh-modpack.json');
}

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
    // 介绍、名称、作者、插件一律以包里的 dsh-modpack.json 为准（打包时填的），
    // 条目里只留定位与版本核对用的字段；写了这些字段就报错，避免两套说法。
    for (const banned of ['name', 'author', 'description', 'plugins', 'strategy', 'version']) {
      if (raw[banned] !== undefined) {
        fail(problems, where, '不要写 ' + banned + '：介绍与插件清单按包里 dsh-modpack.json（打包时填的）显示');
      }
    }
    const category = CATEGORIES.some((item) => item.label === raw.category) ? raw.category : '';
    if (!category) fail(problems, where, 'category 必须是：' + CATEGORIES.map((c) => c.label).join(' / '));
    const fileName = String(raw.file || '').trim();
    if (!FILE_RE.test(fileName)) fail(problems, where, 'file 要指向 packs/ 下的 .dshpack 文件名');
    const sha = String(raw.sha256 || '').trim().toLowerCase();
    if (!SHA_RE.test(sha)) fail(problems, where, '缺少合法的 sha256');
    const declaredSize = Number(raw.size) || 0;
    if (declaredSize > MAX_BYTES) fail(problems, where, 'size 不能超过 64MB');

    // 包文件在仓库里就当场核对一遍：sha256 与大小必须和声明一致，
    // 免得目录里挂一个「指过去的文件早就被换掉了」的条目。
    const packFile = path.join(PACK_DIR, fileName);
    let size = declaredSize;
    let manifest = null;
    if (fs.existsSync(packFile)) {
      const bytes = fs.readFileSync(packFile);
      const actual = crypto.createHash('sha256').update(bytes).digest('hex');
      size = bytes.length;
      if (actual !== sha) fail(problems, where, '包文件 sha256 与声明不一致（声明 ' + sha.slice(0, 12) + '…，实际 ' + actual.slice(0, 12) + '…）');
      if (bytes.length > MAX_BYTES) fail(problems, where, '包文件超过 64MB');
      try {
        manifest = readPackManifest(bytes);
      } catch (error) {
        fail(problems, where, '读不了包里的 dsh-modpack.json：' + String(error.message || error));
      }
    } else {
      fail(problems, where, 'packs/ 下没有这个包文件（目录不搬文件，包必须跟着提交）');
    }
    if (manifest) {
      const format = String(manifest.format || 'lite');
      if (format !== 'lite') fail(problems, where, '现在只收轻量包（包里的 format 是 ' + format + '）');
      const text = manifest.description;
      const zhText = typeof text === 'string' ? text : String((text && text.zh) || '');
      const enText = typeof text === 'string' ? text : String((text && text.en) || '');
      if (!zhText.trim()) fail(problems, where, '包里的 dsh-modpack.json 没写介绍：打包时把「整合包说明」填上，目录直接显示它');
      const pluginList = Array.isArray(manifest.plugins) ? manifest.plugins : [];
      if (pluginList.length === 0) fail(problems, where, '包里一个插件也没有');
    }

    if (!manifest) continue;
    const rawText = manifest.description;
    const zhText = typeof rawText === 'string' ? rawText : String((rawText && rawText.zh) || '');
    const enText = typeof rawText === 'string' ? rawText : String((rawText && rawText.en) || '');
    const pluginList = (Array.isArray(manifest.plugins) ? manifest.plugins : []).map((plugin) => ({
      name: String((plugin && plugin.name) || '').trim(),
      version: String((plugin && plugin.version) || ''),
      latest: Boolean(plugin && plugin.latest === true),
      description: String((plugin && plugin.description) || ''),
    }));
    packs.push({
      id,
      name: String(manifest.name || id).trim(),
      author: String(manifest.author || '').trim(),
      category,
      version: String(manifest.version || '1.0.0'),
      strategy: 'lite',
      file: fileName,
      sha256: sha,
      size,
      createdAt: String(raw.createdAt || ''),
      updatedAt: String(raw.updatedAt || raw.createdAt || ''),
      description: { zh: zhText, en: enText },
      plugins: pluginList,
      homepage: String(raw.homepage || ''),
      ...(typeof raw.downloads === 'number' ? { downloads: raw.downloads } : {}),
      pluginCount: pluginList.length,
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
  // 内容没变就别刷 builtAt：否则每天一次的重建都会产生一个只有时间戳的提交，
  // 和本地提交互相顶牛（之前就因为这个 rebase 出过两次冲突）。
  const previous = (() => {
    try {
      return JSON.parse(fs.readFileSync(OUT, 'utf8'))
    } catch {
      return null
    }
  })();
  // 只比较内容，不比较 builtAt 与键的顺序（{...value, builtAt: ''} 会把 builtAt 挪到末尾，
  // 导致同样的内容永远判不相等，每天重建都会写一次新时间戳）。
  const categories = CATEGORIES.map((category) => ({
    ...category,
    count: packs.filter((pack) => pack.category === category.label).length,
  }));
  const content = (value) => value && JSON.stringify({
    schema: value.schema,
    count: value.count,
    categories: value.categories,
    packs: value.packs,
  });
  const current = { schema: 1, count: packs.length, categories, packs };
  const builtAt = previous && content(previous) === content(current) ? previous.builtAt : new Date().toISOString();
  const output = { schema: 1, builtAt, ...current };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 1) + '\n', 'utf8');
  console.log('packs.json: ' + packs.length + ' 个整合包，' + output.categories.map((c) => c.label + '=' + c.count).join(' '));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
