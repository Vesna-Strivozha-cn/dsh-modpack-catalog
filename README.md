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

## 提交流程

1. fork 这个仓库，新建分支。
2. 用 dsh-modpack-kit 打一个**轻量包**，把 `.dshpack` 放进 `packs/`，再写一份 `data/packs/<id>.json`
   （`sha256` 用 `certutil -hashfile <包> SHA256` 或 `sha256sum` 算）。
3. 本地跑 `node scripts/build.mjs`，确认输出里没有 `构建失败`。
4. 提 PR。CI 会重新跑一遍构建；合并后当天的定时任务（或手动 dispatch）会把新条目并进 `packs.json`。

## 许可与安全

- 只收你自己打的包，或者你能保证有权再分发的插件组合；插件作者没写许可证的组合请先问作者。
- 目录里只放元数据与轻量包（不含插件代码），完整包请自行托管并在清单里写直链与 sha256。
- 发现条目有问题：开 issue 或在 PR 里说明，维护者会下架对应清单。
