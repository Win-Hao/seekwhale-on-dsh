# seek-on-dsh

中文 | [English](README.en.md)

![Seek on DSH](docs/social-preview.png)

一个 DeepSeek Harness 插件：像素化的 DeepSeek 小鲸鱼浮在 `dsh web` 右下角，
跟着你的会话状态做反应。

鲸鱼是 DeepSeek logo 像素化到 **40×31 网格**后逐帧动起来的。每个状态都是
**一个自带 CSS keyframes 的单个 SVG** —— 无 GIF、无 APNG、无脚本 —— 所以放到任意
尺寸都不糊，过任何消毒器也不掉东西。

<p align="center">
  <img src="docs/demo.gif" width="240" alt="鲸鱼依次悬停、干活、受惊、庆祝、喝咖啡、睡着">
</p>

## 安装

```sh
dsh plugin --profile web add seek-on-dsh
dsh web
```

装完就有了，鲸鱼在右下角。**不用手改任何配置**：这个包自带 bundle patch
（`dsh.bundle.patch`），所以 `dsh plugin add` 会把它记进 profile 的
`dsh.profile.bundles`，由它自己的 patch 层把自己插进插件树。**别再往 profile 自己的
`cordis.patch.yml` 里加一遍** —— 那样会插两次。

> 如果安装时 `dsh web` 正开着，装完要重启。宿主把插件表存在内存里，残留的旧条目会让
> 同一份 bundle 在旧路径下再被送一次，触发 `duplicate factory registration`。

## 它在做什么

它挂在 `shell.overlay` 插槽上 —— DSH 专门给这类东西留的全框浮层，可叠加、默认穿透 ——
然后读会话快照。

| 你的会话 | 鲸鱼 |
| --- | --- |
| 有一个在等你批权限（`pendingInteraction: approval`） | 一惊，瞪大眼 |
| 有一个在等你回答问题（`question`） | 仰头琢磨 |
| 有一个在等你审计划（`plan-review`） | 眯眼端详图表 |
| 两个以上会话在跑 | 趴在终端前敲 |
| 一个会话在跑 | 打字，冒思考气泡 |
| 跑完了但你还没去看（`completed`） | 跃出水面庆祝 |
| 都闲着 | 悬停 —— 时不时看看书、喝口咖啡、打哈欠、喷个水 |
| 闲够 90 秒 | 睡着，Zzz 往上飘 |
| 正被你拖着 | 驮着东西 |

**一整个窗口只有一只鲸鱼**，不是一个会话一只；而且急事压过进度 —— 被问话压过还在跑的活，
还在跑的活压过没人去看的完成。

全部状态，各自循环：

| approval | question | review | working | swarm |
|:--:|:--:|:--:|:--:|:--:|
| ![approval](docs/states/approval.gif) | ![question](docs/states/question.gif) | ![review](docs/states/review.gif) | ![working](docs/states/working.gif) | ![swarm](docs/states/swarm.gif) |

| done | idle | read | coffee | yawn |
|:--:|:--:|:--:|:--:|:--:|
| ![done](docs/states/done.gif) | ![idle](docs/states/idle.gif) | ![read](docs/states/read.gif) | ![coffee](docs/states/coffee.gif) | ![yawn](docs/states/yawn.gif) |

| spout | sleeping | carrying | poke | annoyed |
|:--:|:--:|:--:|:--:|:--:|
| ![spout](docs/states/spout.gif) | ![sleeping](docs/states/sleeping.gif) | ![carrying](docs/states/carrying.gif) | ![poke](docs/states/poke.gif) | ![annoyed](docs/states/annoyed.gif) |

有两件事不在快照里，只能靠计时器。一是**睡觉** —— 「什么都没发生」不是一个事件。
二是**待机花活** —— 一只在你不干活的那三分之二时间里只会干悬着的鲸鱼是最无聊的桌宠，
所以每 12–30 秒它挑一个姿势，**只播它自己的一轮**再交还。一轮整数是关键：循环接缝正好
落在切换那一刻，永远看不见。

只有 9 个 `mini-*` 姿势没用上 —— 那是桌面窗口停屏幕边缘的概念，web 里没有对应。

## 怎么跟它玩

- **戳它。** 点一下会一惊；1.8 秒内继续戳它就生气了。生气这一档是 `error` 那张美术
  **唯一**的出场机会 —— 会话快照只说一轮停了，从不说它失败了。
- **拖它。** 拖到任意位置，拖动时放驮东西的姿势，松手记住位置
  （`localStorage`，键 `seek:spot`）。拖不算戳：指针移动没超过 4px、
  且 500ms 内松手，才算一次点击。
- **Alt + 点击**逐个切换全部状态再回到实时，这样不用真去等一个权限弹窗才能看到美术。
  钉住时状态名会显示在鲸鱼头顶。

**能抓的只有鲸鱼本身，不是它那个盒子** —— 抓手取的是主题自己的 `hitBoxes.default`
矩形，约占盒子四分之一面积。其余部分保持穿透：一盒子透明像素没道理把底下应用的点击
全吃掉。

## 构建

```sh
node build.mjs        # src/client.js + assets/ → lib/client.js
```

没有编译器，这是故意的。DSH 把插件的浏览器半边当作**一个文件**发给页面，那个文件调用
`window.__ModuleLoader__.load({ id, factory })`，依赖走 loader 给的 `require` 垫片 ——
它**不是** ES module。这套约定不需要打包器，所以 `build.mjs` 就是做拼接：把美术内联进去、
给 `src/client.js` 套上外壳、写出 `lib/client.js`。

美术是内联而不是另外去取的，因为**只有 `lib/client.js` 这一个路径可寻址** ——
宿主服务的是那个路径，不是整个包目录，旁边放个 `assets/` 在浏览器里会 404。
内联时**做了 gzip**：这些 SVG 是成片重复的 path 和 keyframe 文本，压缩比约 8.7x，
这才让 15 个状态装进 310 KB 而不是 2 MB。浏览器首次用到某个状态时用
`DecompressionStream` 解压，再以 blob URL 交给 `<img>` —— 各自独立的文档，
它们的 CSS 永不相遇。

`lib/client.js` 是提交进仓库的：别人装完这个包，DSH 直接从磁盘读这个文件。

## 目录

```
src/client.js   插件本体 —— 普通可读的 JS，没有构建魔法
build.mjs       内联素材，把 src 套进 DSH 的 bundle 外壳
assets/         它用到的 14 个 SVG（有几个状态共用同一份）
lib/index.js    宿主半边：一个空的 apply()，让条目出现在插件树里 ——
                这才会触发 DSH 去读 dsh.client 并把浏览器半边发出去
lib/client.js   构建产物
```

美术是在另一个创作工作区里从视频解码出来的；这个仓库只带成品 SVG。

## 授权

MIT，见 [LICENSE](LICENSE)。鲸鱼形象衍生自 DeepSeek logo。
