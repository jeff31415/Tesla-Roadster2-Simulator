# v0.1 模拟器集成验证记录

## 当前结果

- `node --test scripts/test-simulator.mjs`：**148 passed，0 failed，0 skipped**。
- `node --test scripts/test-gamepad.mjs`：**14 passed**（手柄死区重标定、标准映射符号规则、按键值域、边沿检测、无手柄逐位等价、叠加钳制、地／飞触发器映射、飞行轴反转、起飞互锁、模拟1.0与键盘轨迹逐位一致、线性喷口分配、震动冷却与事件派生、GamepadInput 热插拔）。
- `node --test scripts/test-vendor-gamepad.mjs`：**3 passed**（无 window/navigator 时惰性、`gameControl.on/off` 与 `joypad.on/vibrate/set` 暴露、无 eval／source map，webpack eval devtool 已改用生产版 dist）。
- `node scripts/check-ui-state.mjs`：**PASS**。该测试读取 `dist/viewer.html`，覆盖原查看器的 DOM 状态、模式、展开滑块、喷口说明、GLB 导出与无 WebGL 回退；不把 DOM mock 当作真实渲染证明。
- `npm run check`：**PASS**。6746 三角形、283 网格、10 喷口、6 张资料图片；GLB 522356 bytes、270 导出节点。
- `python3 scripts/test-browser.py`：真实无头 Chromium **66 项检查通过**；模拟器与查看器均无 JavaScript `pageerror`。使用软件 WebGL 参数 `--enable-unsafe-swiftshader`，不是特定 GPU 的性能验证。

## 单文件分发构建验证

- `npm run build`：**PASS**；21模块（新增 `gamepad-input.js`、`gamepad-rumble.js` 与 vendored `gamecontroller.js`、`joypad.js`），`dist/roadster-rocket-standalone.html` **1,563,997 bytes**。Three.js、gamecontroller／joypad MIT许可、CSS与模拟器内联，无外部模块加载。
- `node --test scripts/test-single-html.mjs`：**17/17 passed**。验证确定性、脚本编译、完整21模块／CSS／许可、路径独立执行、非法模块语法／循环／越界引用拒绝，以及HTML／模块／CSS／许可直写与符号链接覆写保护。
- 全量Node回归：**182/182 passed**（模拟器148＋构建17＋手柄14＋第三方库3）。
- `python3 scripts/test-standalone.py`：真实Chromium **26/26 passed**。只复制生成HTML到含空格／Unicode的隔离临时目录，使用 `file://` 与离线浏览器上下文；**HTTP请求0、其他资源请求0、请求失败0、pageerror0**。覆盖WebGL渲染、驾驶、喷流耗气、重置、改键、轴反转、实际起飞保护、LANDING和音频解锁、Orbit拖拽滚轮、子弹时间空地切换、2×2网格状态、真实录制／reset回放／Esc退出与自然结束，以及**21模块初始化（含 `rocketLab.pad.poll/start` 与 `rocketLab.rumble.update` 接线）**。前轮Reviewer曾独立运行旧16项；26项由集成方完整执行。
- Reviewer首轮发现输出路径可能覆写Three许可或通过符号链接覆写输入，已改为canonical realpath比较并补测试；针对性复审 **Approve for commit**，17项构建回归独立通过。
- 构建器为本项目约束语法设计，不是通用ESM转换器；不保证hard-link别名／恶意并发文件系统修改防护。离线浏览器配置持久化受各浏览器file-origin政策影响，已有异常回退。跨浏览器／真实GPU仍未验收。

## v0.1 新增与相机抖动回归

- 飞行Yaw改为D负Y／A正Y，地面物理未动，轴反转继续生效。
- LANDING下降目标 `clamp(1.5+.4375h,1.5,5)`、闭环 `g/up+3(v_d-v_d*)`，慢下降主动减推；9个无约束落地场景无近地hover。h=0目标1.5，不保证实际触地精确值。
- Orbit四视角、鼠标／触控与3–35m缩放；空中BulletTime=.5x；Playback30Hz／120s有界录制、reset就绪、插值回放／退出；四路口／25批城市与6NPC多路口信号巡航。
- 相机抖动修复：模型与相机共享RenderPose插值；追踪平滑相对boom而非世界坐标，heading最短弧／近垂直保留；显式rebase区分回放瞬移，移动视角切换同步车位移，visibility丢弃累计时间时同步历史。
- 数值回归覆盖144Hz恒速插值、20m/s@144Hz与60m/s@10Hz视角切换收敛、4m／100m回放退出连续性、±pi／垂直heading和visibility无倒退。额外真实Chromium检查17帧：model COM与camera输入同一RenderPose，误差0，相对boom X变化范围0，无pageerror。
- v0.1完整HTTP Chromium回归66项PASS；软件渲染用0.25像素比／关闭阴影且保留真实WebGL、原CSS视口；点击为命中测试后的真实鼠标事件。曾有210s超时，最终300s边界内全量通过，不依赖超时子任务结果。

## 最终复审

**APPROVE — v0.1 release / commit**：Reviewer 全量审查飞控、相机抖动修复、慢动作、回放、地图／NPC、UI与构建产物，未发现阻塞项；独立重跑 **165/165**（148模拟器＋17构建）、资产检查、根目录DOM检查与diff空白检查均通过。集成方HTTP Chromium **66项PASS**，离线Chromium **26项PASS**；Reviewer未重复慢浏览器套件。此前相机回归发现的移动目标永不收敛、短回放瞬移／高速低帧率、visibility历史倒退均已修正并补回归。

## 针对性修复与回归范围

1. **地面翻滚检测**：接地时超过 45° 的姿态检测独立于首次着陆／报告窗口。数值回归覆盖未激活飞行判定的 44.9999°、45°、45.0001°、60°，无敌开关、重复事件防护，以及完成正常着陆报告后再次翻滚。
2. **按键释放与控件焦点**：HUD 获得焦点、blur、visibilitychange 清除驾驶输入；捕获阶段的 keyup 总是移除释放键。复审发现 Space 的默认按钮激活也被取消，现仅在驾驶上下文阻止默认行为，保留控件键盘操作。
3. **查看器入口**：DOM 冒烟测试使用 `viewer.html`；真实 Chromium 也加载该入口并切换透视模式。
4. **重置报告与状态**：数值测试覆盖真实待定／已报告的正常着陆与坠毁状态重置，确认没有延迟事件。浏览器检查按钮 Space 和驾驶上下文 R 都能清除相关状态／报告，并恢复驾驶焦点。

5. **方向修复**：地面转向符号反转；飞行 Q/E 滚转符号反转；v0.1飞行 A/D 偏航基线统一为D负Y／A正Y。数值测试覆盖前进／倒车 Ackermann、直接／辅助各轴力矩符号与角速率收敛。
6. **自定义按键**：11 项新增单元测试覆盖 12 个默认动作、分模式 W/S、共享升力、左右修饰键、版本化持久化、异常／损坏存储回退、非法键与动作、订阅快照、默认恢复和重复绑定。浏览器覆盖实际点击捕获改键、modal 防误输入、HUD 动态提示、I/K 分模式映射、T 重置、刷新后保留、Escape 行为、默认恢复，以及 390×844／844×390 的入口和关闭按钮可访问性。

7. **LANDING角度级联**：新增数值测试验证不同航向下中立回正力矩、±30°定角收敛／松杆恢复、Yaw速率不变、0.2秒混合、进入退出滞回和GROUND／DIRECT退出。HUD显示LANDING ASSIST。
8. **起飞持键保护**：默认W与自定义油门I／低头K真实起飞均验证双向Pitch阻断、物理键名警告、keyup立即解除、新按键生效及反转不能绕过；额外覆盖HUD焦点清键＋auto-repeat绕过回归。
9. **飞行轴反转**：所有8种组合只交换对应飞行输入，实际直接／辅助力矩随之反转，地面物理转向与油门不变；兼容旧version1载入、无效数据／存储失败回退、默认恢复false。共新增26项单元测试，原86项保留。

## 手柄输入（Gamepad）

- **架构**：`dist/gamepad-input.js` 每帧轮询 `navigator.getGamepads()`（事件库粒度不足以驱动模拟量），`gamecontroller.js` 负责连接／断开事件与 `PAD:` HUD，`joypad.js` 提供 `vibrate` 振动；两库以 IIFE＋命名导出包装 vendored，Node 测试下惰性无害。
- **符号与死区**：摇杆死区0.14、扳机0.05，区内归零、区外按 `(m-d)/(1-d)` 重标定。左≡A（转向／偏航正Y）、后拉≡S（俯仰抬头）、右≡E（滚转）；RT＝油门／助推、LT＝刹车／升力、A/LB＝升力、X＝助推、Y＝相机、View＝重置、D-pad↑↓＝Orbit缩放，映射固定不进改键浮层。
- **合并语义**：`mergeControls` 输出恒为有限轴字段，无手柄时与布尔键盘路径**逐位一致**（测试断言）；手柄与键盘同向叠加按±1钳制。飞行反转只作用于手柄摇杆轴且仅FLIGHT模式（由 `keybinds.inversions` 统一开关），地面转向永不反转。
- **互锁**：`takeoff-lock.js` 接受 `padBlocked`＋`padPitchHeld`（右摇杆|y|>0.5），地面→飞行瞬间按住即双向阻断俯仰，回中解除；与物理按键释放互锁同一条 fail-closed 路径。
- **震动**：`gamepad-rumble.js` 按 kind 独立冷却（impact 160ms／boost 220ms／crash 900ms／launch 900ms），撞击强度 `g/6` 线性、g=0不震，坠毁／发射沿触发，助推按500ms节奏重复；注入时钟与vibrate可测。
- **等价性**：`driveAxis=1 ≡ forward=true`、`steerAxis=1 ≡ left=true` 等在真实 `VehiclePhysics` 上跑90帧，位置／角速度／四元数逐位一致；半油门／半转向落在满幅与零之间。控制器侧 RT/LT/A/X 线性填充节流，飞行轴按 `axis×rate` 缩放目标角速率。

## 浏览器检查

脚本：`scripts/test-browser.py`。使用 Python 的可选 `playwright` 包及已安装 Chromium；模拟器运行本身不需要这些依赖。先启动静态服务器，再执行：

```bash
# 终端一，从 roadster-lab/ 运行
python3 -m http.server 8080 --directory dist

# 终端二，从 roadster-lab/ 运行
python3 scripts/test-browser.py
# 可选：ROADSTER_URL=http://127.0.0.1:其他端口/
```

检查包含：WebGL 页面运行、驾驶按键生效、HUD 焦点清键、控件上的捕获释放、方向键调节滑块、Space 激活 DIRECT／ASSISTED／REFILL／关闭报告／RESET 且不误触升力、R 清除真实待定着陆及报告、无旧报告复现、Escape 返回驾驶、查看器切换模式与页面异常检查。

截图：[`simulator-regression.png`](simulator-regression.png)、[`simulator-keybinds.png`](simulator-keybinds.png)。截图显示当前城市道路、车辆、遥测和控制 HUD；它不是全部物理场景的视觉验收。

## 边界与未验证事项

- blur／visibilitychange 在浏览器内显式派发事件验证注册的处理逻辑，**没有验证操作系统切窗或真实后台标签页调度**。
- 未进行跨浏览器、真实移动硬件、真实 GPU 性能、音频主观体验或长时间人工游玩验收；移动尺寸仅在 Chromium 中模拟视口。
- **手柄为软件层验证**：无真实手柄硬件接入，模拟量手感、振动强度、XInput／DualSense 标准映射差异与热插拔均未真机测试；`getGamepads()` 在无手柄环境返回空即静默降级为纯键盘。
- 本轮扩展浏览器脚本在软件渲染下曾超过170秒；测试场景现将WebGL像素比降为0.5、保留原CSS视口，最终在240秒工具上限内完整通过66项。此优化仅在测试脚本内，不改变游戏默认渲染。浏览器／操作系统保留快捷键不保证可捕获。
- 起飞物理键的keyup若在浏览器失焦期间丢失，会保守保留锁定；重新按下并松开提示键恢复。这是fail-closed设计，不会因焦点清键误解锁。
- 接地数值与控制回归验证的是本游戏实现，不代表真实车辆性能或物理参数校准。
- 前轮开发时未提供Git元数据；本次单文件目标任务开始时仓库已初始化，按明确路径审查／暂存并遵循Conventional Commits与指定Co-Authored署名提交。
- 之前超时的补充测试子任务已取消，本记录采用新加入并实际运行的回归脚本结果，不依赖该子任务。
