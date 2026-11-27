# dsh-modpack-catalog

DSH 整合包目录（只存清单与元数据，不搬别人的文件）。规则与插件市场的插件目录同一套思路：
**提交清单 → CI 校验 → 生成 `packs.json` → 客户端按目录浏览**。

- `packs.json`：机器读的目录（每日 03:17 UTC 由 `scripts/build.mjs` 重新生成并提交）。
- `data/packs/*.json`：每个整合包一份清单，靠 PR 提交。
- `packs/*.dshpack`：可选的包文件本体（轻量包一般只有十几 KB，放仓库里最省事；大包请放 Release，清单里写 `url` 即可）。

## 分类与体量

- 分类里有一个 **水槽**：一个包里的插件横跨三种以上插件市场分类时，构建会自动把它归到这里（不用作者硬塞）。
- 体量词条由插件总数自动算：0-3 轻量、4-8 中型、9-12 大型、13+ 大宗，作者不用填。

## 现在只收轻量包

第一阶段只收 `strategy: "lite"` 的整合包：只记插件名与版本、不带插件本体，安装时由
dsh-modpack-kit 联网按版本取包。这样校验简单、仓库也小；完整包/混合包以后再说。

## 条目格式（`data/packs/<id>.json`）

```json
{
  "id": "bili-trio",
  "name": "B站三件套",
  "author": "你的名字",
  "category": "实用功能",
  "version": "1.0.0",
  "strategy": "lite",
  "file": "bili-trio-lite.dshpack",
  "sha256": "…64 位小写十六进制…",
  "size": 12226,
  "createdAt": "2026-11-27",
  "description": { "zh": "一句话说明这个包解决什么问题", "en": "one line in English" },
  "plugins": [
    { "name": "dsh-bili-account-bridge", "version": "0.1.6", "description": "可选" }
  ],
  "homepage": ""
}
```

字段规则（`scripts/build.mjs` 会逐条挡）：

| 字段 | 规则 |
|---|---|
| `id` | 3~40 位小写字母/数字/短横线，全局唯一 |
| `name` / `author` | 非空 |
| `category` | 必须是：工作办公 / 性能优化 / 界面美化 / 实用功能 / 开发调试 / 娱乐休闲 / 学习资料 / 其它 |
| `strategy` | 现在只能是 `lite` |
| `file` | `packs/` 下的 `.dshpack` 文件名；文件在仓库里时 sha256 与 size 会被当场核对 |
| `sha256` | 64 位小写十六进制 |
| `size` | 字节数，≤ 64 MB |
| `plugins` | 至少一个，`name` 必填、`version` 必须是 `x.y.z` |

`downloads` 不用手写：构建时会把包里各插件在 npm 的**上周下载量**加起来填进去。

## 提交流程（照这个走就不会卡）

**第 0 步：准备一个轻量包**

在 dsh-modpack-kit 的「打包」页里，策略选「轻量包」，勾上要带走的插件，打包并下载成 `<名字>-<日期>-lite.dshpack`。
轻量包只有清单与配置，十几 KB；装的人在本地联网按版本取包。

**第 1 步：算 sha256 与体积**

- Windows：`certutil -hashfile 名字-lite.dshpack SHA256`
- macOS / Linux：`shasum -a 256 名字-lite.dshpack`
- 体积：`stat -c %s`（Linux）或 `ls -l` 看字节数；不能超过 64 MB。

**第 2 步：fork + 分支**

```bash
git clone https://github.com/<你>/dsh-modpack-catalog
cd dsh-modpack-catalog
git checkout -b add-<包id>
```

**第 3 步：放两样东西**

1. 把包放进 `packs/`：文件名只许字母数字 `.` `_` `-`，例如 `packs/test-basic-2026-11-27-lite.dshpack`。
2. 写 `data/packs/<id>.json`（格式见下一节）。

**第 4 步：本地先构建一遍**

```bash
node scripts/build.mjs
```

正常会打印 `packs.json: N 个整合包，…`；出现 `构建失败` 就按提示改（最常见：sha256 或 size 对不上、分类写错、插件版本不是 x.y.z）。

**第 5 步：提交并提 PR**

```bash
git add packs data/packs
git commit -m "add: <包显示名>（<分类>）"
git push origin add-<包id>
```

然后在 GitHub 上开 PR。CI 会重跑一遍 `scripts/build.mjs`，PR 里的 `packs.json` 不用手工改。

**第 6 步：合并后等目录重建**

- 定时任务：每天 `03:17 UTC`（本地 11:17）跑一轮，重建 `packs.json` 并提交。
- 想立刻进目录：仓库 Actions 页面手动 `Run workflow`（`daily.yml` 支持 `workflow_dispatch`），一轮约十几秒到一分钟。
- 客户端（dsh-modpack-kit）最多缓存 24 小时；等不及就在「社区资源」里点一次同步。

> 想撤下自己提交的条目：开 PR 删掉 `data/packs/<id>.json` 与对应包文件即可；已合并的会在下一轮目录重建后消失。
## 许可与安全

- 只收你自己打的包，或者你能保证有权再分发的插件组合；插件作者没写许可证的组合请先问作者。
- 目录里只放元数据与轻量包（不含插件代码），完整包请自行托管并在清单里写直链与 sha256。
- 发现条目有问题：开 issue 或在 PR 里说明，维护者会下架对应清单。
