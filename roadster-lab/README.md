# Roadster Rocket Lab v0.1 — 驾驶与冷气推进实验

基于 Three.js 的浏览器实验游戏：在地面驾驶低多边形 Roadster，使用冷气推进器起飞、调整姿态并尝试着陆。车辆外观来自公开图像的独立艺术重构；物理参数是游戏实验假设，**不是 Tesla 官方数据、工程复原或真实车辆的设计／安全参考**。

## 启动：无需安装依赖

Three.js 及所需附属模块已本地附带，不需要 npm install、打包或外部 CDN。安装 Python 3 后，从仓库根目录运行：

```bash
cd roadster-lab
python3 -m http.server 8080 --directory dist
```

打开 <http://localhost:8080/> 进入模块化模拟器。此入口需要支持 JavaScript、ES modules 和 WebGL2；`dist/index.html` 请通过 HTTP 访问。**单文件离线版则支持直接双击，见下文。** 静态服务器无需额外 Python 包。

原结构／资产查看器保留在 <http://localhost:8080/viewer.html>，不与模拟器共用控制键。

## 单 HTML 离线分发版

从 `roadster-lab/` 执行（只需 Node.js，无需 `npm install`）：

```bash
npm run build
# 等价命令：npm run build:single
# 也可从任意目录运行：node /项目绝对路径/roadster-lab/scripts/build-single-html.mjs
```

生成 **`dist/roadster-rocket-standalone.html`**（当前约1.48 MB，已随代码提供）。只复制这一个文件即可离线分发，直接双击以 `file://` 打开；无需 HTTP 服务器或同目录资源。CSS、Three.js r170、模型及21个运行模块已内联为一个经典自执行脚本，内含 Three.js 与 gamecontroller.js／joypad.js 的 MIT 许可，无外部请求、模块加载或 CDN。

- 功能包含城市模拟器、音效、HUD、自定义按键、三轴反转、键盘＋手柄驾驶／飞行和起飞／落地辅助；**原资产查看器及图片库不包含在此分发文件内**。
- 仍需当前浏览器支持 WebGL2／硬件加速；音频需首次用户交互。部分浏览器对 `file://` 的 `localStorage` 限制不同，禁用存储时自动退回当前会话内配置，不影响驾驶。
- 修改模块源码或样式后请重新构建；相同输入生成字节相同的产物。不要直接编辑生成的 HTML。
- 构建器只支持本项目实际使用的静态 named／namespace imports、const／function／class 与导出列表；不是通用 ESM 打包器，遇动态 import、循环依赖、默认导入／导出、外部资源等会报错停止。

验证命令：

```bash
npm run test:single                         # 17项构建／语法／确定性／拒绝路径测试（21个内联模块）
node --test scripts/test-simulator.mjs     # 148项物理／输入／场景／相机／回放测试
node --test scripts/test-gamepad.mjs       # 14项手柄死区／映射／反转／互锁／震动测试
node --test scripts/test-vendor-gamepad.mjs # 3项 gamecontroller.js／joypad.js 第三方库冒烟测试
python3 scripts/test-standalone.py         # 可选 Playwright + Chromium，真实file://离线测试
```

浏览器验证脚本将**仅单个HTML**复制到含空格和Unicode的临时目录，启用离线环境并阻止HTTP请求；检查渲染、驾驶／喷口、改键、反转、起飞保护、LANDING与音频初始化。测试工具是可选开发依赖，分发文件运行无需 Python、Node或Playwright。

## 键盘操作

| 按键 | 地面 | 飞行 |
| --- | --- | --- |
| `W` / `S` | 加速 / 制动（低速时可倒车） | 机头下俯 / 上仰 |
| `A` / `D` | 左右转向 | 左右偏航 |
| `Q` / `E` | — | 左右滚转 |
| `Space` | 开启底部升力喷口 | 请求升力 |
| `Shift` | 后部火箭助推 | 后部火箭助推 |
| `R` | 重置车辆、姿态与气罐 | 同左 |
| `C` | 切换相机 | 同左 |

先用 `W` 熟悉地面驾驶，再短按 `Space` 起飞；离地后 `W/S` 的含义改为俯仰。冷气推进消耗储气并降低压力，长时间按住推进键会很快耗尽；不要把升力键当作永久悬停开关。观察速度、离地高度、垂直速度、姿态、气罐压力与各喷口节流量，再尝试低下降速度、接近水平的着陆。

## 手柄操作（Gamepad，标准映射）

支持标准映射的 XInput／DualShock／DualSense 等手柄，即插即用，HUD 顶部显示 `PAD: <设备名>`。摇杆与扳机为全模拟量（死区摇杆 0.14、扳机 0.05，区内归零、区外重标定到全量程），与键盘路径可以叠加并按 ±1 钳制。手柄采用固定默认映射，不参与改键浮层；飞行轴反转开关同时作用于手柄摇杆轴（仅飞行，不影响地面）。

| 手柄 | 地面 | 飞行 |
| --- | --- | --- |
| 左摇杆 | 转向（左 ≡ `A`）／Orbit 相机时旋转 | 偏航（左 ≡ `A`） |
| 右摇杆 | Orbit 相机拖拽（飞行模式外） | 俯仰（后拉 ≡ `S` 抬头）／滚转（右 ≡ `E`） |
| `RT`（右扳机） | 油门（模拟量，等价 `W`） | 后部火箭助推（等价 `Shift`） |
| `LT`（左扳机） | 刹车／低速倒车（等价 `S`） | 底部升力（模拟量，等价 `Space`） |
| `A` / `LB` | 升力喷口 | 请求升力 |
| `X` | 助推 | 助推 |
| `Y` | 切换相机 | 同左 |
| `View`（Select） | 重置车辆、姿态与气罐 | 同左 |
| `D-pad ↑ / ↓` | 缩放 Orbit 相机（3–35m） | 同左 |

- 手柄与键盘共享同一物理、互锁与反转管线：起飞 Pitch 保护同样会在地面→飞行瞬间因手柄俯仰摇杆超过 0.5 而锁定，回中后解除。
- 振动默认开启（joypad.js），撞击按 `g` 值、坠毁、发射与助推各有独立冷却（160–900ms），不支持振动的设备静默降级。
- 拔掉手柄立即回到纯键盘，`PAD:` 指示消失；无手柄时输入与旧版逐位一致，不影响既有测试与手感。
- 仅浏览器 `gamepadconnected`/`getGamepads()` 能力可用时启用；仓库 vendored 的 gamecontroller.js（事件／连接状态）与 joypad.js（振动）均为本地文件，无 CDN 请求。

### 自定义按键（KEYBINDS）

点击左下控制面板的 **KEYBINDS / CUSTOMIZE CONTROLS** 打开配置浮层。点击操作对应按钮，出现 **Press any key…** 后按新键即可保存。支持地面油门／刹车、共享转向／偏航、独立飞行俯仰、滚转、升力、尾推、重置和相机共 12 个动作。

- 修改立即更新 HUD 快捷键提示，并自动持久化到 `localStorage`；储存不可用时仍可在当前页面使用。
- 浮层开启期间屏蔽驾驶输入。`Escape` 取消当前捕获，再按一次关闭浮层；`Tab` 保留焦点导航。
- **Reset to Defaults** 恢复默认；默认地面 `W/S` 和飞行俯仰 `W/S` 可独立改键。左右 Shift（及其他修饰键）视为同一绑定。
- 允许多个动作使用相同键；若分配给同一模式中的多个动作，会同时触发。浏览器或操作系统保留快捷键可能无法被页面捕获。
- 地面 A/D 转向与飞行 Q/E 滚转响应保留上一轮驾驶反馈修正；v0.1 飞行 A/D 偏航已统一为 A=正Y、D=负Y，与地面转向基线一致；Yaw反转在此基线上生效。
- **Invert Pitch / Invert Yaw / Invert Roll**：三轴独立反转，仅作用于飞行控制（包括 LANDING 的角度指令和手柄飞行摇杆），绝不影响地面转向／油门。与按键配置一起保存，恢复默认时全部为 false。旧版本按键记录兼容加载。

### 控制与练习选项

- **ASSISTED（辅助）**：正常飞行采用角速率内环。满足近地下降条件时切入 **LANDING ASSIST**：使用线性下降率闭环：`v_d*=clamp(1.5+0.4375h,1.5,5)`，推力指令加速度 `g/up+3(v_d-v_d*)`。下降太慢会削减推力，不再悬停等待；h=0目标严格为1.5m/s，实际跟踪存在滞后，不保证精确触地速度。Roll/Pitch 切换为绝对角度控制，按键满幅对应 ±30°，松杆目标为水平0°；Yaw仍为角速率。角度外环驱动速率PID，约0.2秒混合切换。进入条件为离地高度≤8m、车身朝上分量>0.65、下降>0.05m/s；爬升>0.25m/s、高度>8.5m或朝上分量≤0.60时退出，触地立即恢复地面法则。辅助受气压／推力限制，不保证安全着陆。
- **起飞 Pitch 保护**：地面→飞行时若油门或低头键仍按住，会暂时阻断双向Pitch，并显示 `RELEASE [当前物理按键] TO ENGAGE PITCH`。松开相关键后立即解除，重新按下可操纵。HUD／弹窗焦点切换不会视作物理松键，自动重复按键不能绕过保护。如果切出浏览器导致 keyup 丢失，重新按下并松开提示键即可解锁。
- **DIRECT（直接）**：直接姿态喷口混控，不提供辅助模式的角速度闭环或近地下降辅助，需要自行反向操作制止旋转。
- **ATTITUDE RATE（灵敏度）**：界面范围为 **90–360°/s**；在辅助模式中设置目标姿态角速度。直接模式使用固定喷口混控，不应把该数值理解为飞行器实际能达到的角速度保证。
- **REFILL**：恢复储气量与压力，不重置位置或消除坠毁锁定。
- **Invincible**：练习用无敌选项，跳过坠毁判定；不移除重力或改变几何碰撞边界。
- **Infinite gas**：无限储气，维持满气量与压力，不代表真实续航能力。
- **RESET / R**：重新开始；进入 `CRASHED` 后用它解除锁定。

### v0.1 相机、慢动作与回放

- **相机 C**：3/4 Chase → Direct Chase → Top-down → Orbit。Orbit跟随车中心，鼠标／单指拖拽旋转、滚轮／双指缩放3–35m。模型和相机共享固定物理步之间的渲染插值；追踪相机平滑相对臂与航向，近垂直保留航向，切换视角／退出回放平滑过渡，避免高刷新率抖动。
- **Bullet Time**：默认关闭；开启后仅离地（包括四轮离地滞回期间）按0.5x推进物理、控制器与模拟时钟，地面保持1x。HUD显示 `SLOW-MO 0.5x`。
- **Record**：UI开启／停止，30Hz记录最多120秒／3601帧；新录制替换旧轨迹。按R或RESET结束录制并启用 `Play Replay`。
- **Play Replay**：暂停物理与驾驶，插值位置／四元数、车轮、喷口及HUD；显示进度。`Exit Replay`、Esc或自然结束后还原进入回放前的停车状态，相机平滑返回。录制只保留当前内存，不导出、不保存NPC轨迹。
- **2×2城市网格**：四路口中心(0,0)/(480,0)/(0,480)/(480,480)，地图边界−240～720m；道路／人行道顶面y=0，25个全局实例批，6辆NPC在双路口路线循环并按独立相位停车。

## 物理假设与数值步进

所有以下数值均为本实验设定，而非经验证的实车规格。

| 项目 | 设定 |
| --- | --- |
| 气罐容积 `V` | 600 L = 0.6 m³ |
| 初始压力 `P₀` | 80 MPa |
| 初始温度 `T₀` | 293.15 K |
| 压缩因子 `Z` | 1.38 |
| 空气比气体常数 `R_air` | 287.05 J/(kg·K) |
| 初始气体质量 | `m₀ = P₀ V / (Z R_air T₀) ≈ 413.347 kg` |
| 干质量 | 1500 kg；瞬时总质量 = 干质量 + 剩余气体质量 |
| 满压单喷口推力 | 后部 R1–R4：各 20 kN；底部 L1–L4：各 20 kN；偏航 Y1–Y2：各 5 kN |
| 比冲 `Isp` | 68 s |
| 标准重力 `g₀` | 9.80665 m/s² |
| 物理步进 | 固定 60 Hz，每步含 4 个微步 |

储气质量流量采用 `ṁ = ΣF / (Isp · g₀)`。放气压力按简化幂律 `P = P₀ (m / m₀)^1.25` 更新，喷口推力随 `P / P₀` 缩放，再乘各自节流量。初始状态方程与放气幂律只是近似，不是完整的高压真实气体、热交换或喷管流动求解。冷气喷流不是燃烧火焰。

## 真实边界与未实现内容

- **物理接触面只有平坦地面**：车轮悬挂与车体接触点对地面求解。道路和建筑是场景表现，没有车辆—建筑或车辆—车辆实体碰撞；NPC 仅使用行为避让，仍可能穿插，不能当作碰撞系统验证。
- **没有真实车辆损伤或形变**：严重着陆可触发游戏 `CRASHED` 状态并锁定驱动／推进，按 `R` 重置；这不是零部件断裂、渐进损伤、车体变形或结构强度仿真。
- 轮胎、空气阻力、悬挂、质量分布、喷口位置和控制分配均为简化。辅助控制存在推力和姿态约束，不承诺任何着陆结果。
- 外观尺寸、内构与十个喷口坐标是建模近似；四个后部可见喷口与六个推断位置的证据等级见 `docs/EVIDENCE.md`。不要据此推算真实 Roadster 的性能、储气装置可行性或人员安全。
- 本作是**实验游戏而非 Tesla 工程参考**；数值测试也不能替代真实浏览器交互检查或物理模型校准。

## 文件与修改入口

以下路径相对 `roadster-lab/`：

| 文件 | 用途 |
| --- | --- |
| `dist/index.html` | 模拟器入口 |
| `dist/simulator.js` | 场景集成、键盘、相机与固定步进主循环 |
| `dist/simulator.css` | 模拟器界面样式 |
| `dist/physics.js` | 刚体、悬挂、轮胎、地面接触、储气和着陆状态 |
| `dist/camera-rig.js`, `dist/time-scale.js`, `dist/playback.js` | 相机／渲染插值、空中慢动作、轨迹录制与回放 |
| `dist/controller.js` | 辅助／直接姿态控制与十喷口分配 |
| `dist/keybinds.js`, `dist/keybind-panel.js` | 按键验证／飞行轴反转／模式映射／容错持久化与改键弹窗 |
| `dist/takeoff-lock.js` | 起飞物理持键释放保护（键盘＋手柄俯仰摇杆） |
| `dist/gamepad-input.js` | 手柄轮询、死区、符号映射、键盘＋手柄合并与连接状态 |
| `dist/gamepad-rumble.js` | 撞击／坠毁／发射／助推振动冷却调度 |
| `dist/world.js` | 地面、道路、建筑和环境场景 |
| `dist/npc.js` | NPC 车辆与行为避让 |
| `dist/ui.js` | 遥测、控制选项与着陆报告 |
| `dist/audio.js` | 浏览器声音合成 |
| `dist/effects.js` | 喷流等视觉效果 |
| `dist/viewer.html`, `dist/style.css`, `dist/main.js` | 保留的原结构／资产查看器 |
| `dist/model.js`, `dist/data.js` | 可复用车辆模型、喷口布局、部件与来源资料 |
| `dist/vendor/` | 本地 Three.js、OrbitControls、GLTFExporter、gamecontroller.js、joypad.js 与许可 |
| `scripts/test-simulator.mjs` | 模拟器数值与行为测试 |
| `scripts/test-gamepad.mjs`, `scripts/test-vendor-gamepad.mjs` | 手柄输入合并／互锁／震动与第三方库测试 |
| `scripts/test-browser.py` | 可选 Playwright／Chromium 交互回归 |
| `scripts/build-single-html.mjs` | 零依赖单文件打包器 |
| `scripts/test-single-html.mjs`, `scripts/test-standalone.py` | 构建与真实file://离线验证 |
| `dist/roadster-rocket-standalone.html` | 生成的独立分发文件 |
| `docs/SIMULATOR-VERIFICATION.md` | 模拟器验证结果、复现步骤与覆盖边界 |
| `docs/EVIDENCE.md` | 原模型图片来源、内构边界与喷口推断依据 |

## 原资产查看器与模型导出

访问 `/viewer.html` 可继续使用原有外观／透视／爆炸视图、连续结构展开、喷口与气流标记、部件说明、参考图、预设相机和自动旋转。拖动旋转，滚轮缩放，右键平移；触屏可单指旋转、双指缩放和平移。

查看器的 **导出模型 .GLB** 按钮仍导出标准装配态，不受当前爆炸程度影响。预生成资产可直接访问：

- [`dist/roadster-rocket.glb`](dist/roadster-rocket.glb)：包含分组、部件名和位置元数据。
- [`dist/roadster-rocket.obj`](dist/roadster-rocket.obj) 与 [`dist/roadster-rocket.mtl`](dist/roadster-rocket.mtl)：通用静态网格与材质，需要一起导入。

模型坐标为 +X 车头、+Y 上方、+Z 车身左侧。艺术建模单位及喷口位置不能当作真实安装尺寸；查看器的气流箭头只表示排气方向，车身受力方向相反。

## 测试与验证

在 `roadster-lab/` 下，使用 Node.js 18+ 运行，不需要安装 npm 依赖：

```bash
node --test scripts/test-simulator.mjs
```

原资产可独立重新生成并检查：

```bash
node scripts/export.mjs
node scripts/check.mjs
```

当前数值回归 **165/165 通过**（物理／输入／场景 148＋手柄 14＋第三方库 3），单文件构建测试 17/17，原资产检查与查看器 DOM 冒烟测试通过；可选的 `python3 scripts/test-standalone.py` 已在真实无头 Chromium 中通过 **26 项检查**（含21个内联模块初始化与手柄接线），模拟器和查看器未出现 JavaScript 页面异常。浏览器脚本需要额外安装 Python Playwright 与 Chromium，并先启动静态服务器，不属于游戏运行依赖。详细结果、截图及未验证事项见 [`docs/SIMULATOR-VERIFICATION.md`](docs/SIMULATOR-VERIFICATION.md)；这些结果不等于跨浏览器、性能或完整人工游玩验收。**真实手柄硬件（模拟量手感、振动反馈、热插拔）尚未经真机验证，仅有软件层测试。**

## 资料与使用权

原模型基于公开 Tesla Roadster 图像制作，原研究日期为 2026-10-17。图片来源见查看器与 `docs/EVIDENCE.md`，图片版权归 Tesla，本项目不提供图片的再次授权。Three.js 及官方附属模块为 MIT 许可，见 `dist/vendor/LICENSE.three`。本项目不是 Tesla 官方作品，未使用官方 CAD、扫描数据或非公开结构图。
