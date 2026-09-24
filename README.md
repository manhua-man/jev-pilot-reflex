# JevPilot Reflex 🚗🛡️

> **Three.js 智驾决策与“AI 安全闸”仿真实验室**  
> *Three.js Autonomous Driving Reflex & AI Safety Brake Simulator powered by TypeSafe Jev System 1/2 Dual-Brain Architecture.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeSafe Jev](https://img.shields.io/badge/Architecture-TypeSafe%20Jev%20Reflex-00e5ff)](https://github.com/standardagents/jevpilot)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-manhua777.site-success)](https://manhua777.site/jev-pilot-reflex)

---

## 📖 简介 / Overview

在 120 km/h 的高速公路上，车辆每秒飞驰 **33.3 米**。

传统端到端多模态大模型（Vision-Language Models）做智驾规划时，单次 Token 生成时延普遍高达 **300ms ~ 800ms**。这意味着在大模型“思考”完成前，车辆已经盲开了整整 **10 到 26 米**——在高速突发追尾或静止障碍物前，这往往是生与死的距离。

**JevPilot Reflex** 是一套基于 **Three.js 高仿真物理环境**、**TypeSafe Jev 毫秒级类型化决策** 与 **System 1 / System 2 双脑解耦架构** 的开源 3D 具身智驾仿真实验室：
- **真实 3D 车辆与环境**：采用工业级 Tesla Model Y GLTF (Draco 压缩 PBR 材质)、阿克曼转向运动学底盘、程序化城市街道、城镇与 8 号州际公路。
- **System 1 (Jev 本地反射小脑)**：内置高性能启发式反射求解器与多候选轨迹流形评价机制，单步决策仅 **1.5 ms**，**100% 离线运行，无需任何 API 密钥或云端服务器**！
- **AI 安全闸 (Safety Brake)**：基于动力学 TTC（Time To Collision）对执行机构实施物理级仲裁；无论上层规划如何，一旦跌破临界 TTC（1.6s），瞬间强行介入 100% 刹车制动！
- **System 2 (宏观策略大脑)**：异步慢速推理接口（兼容远程 Jev API / VLM），在置信度下降或长程路径变动时给出战略建议，**绝不阻塞 60 FPS 主控循环**。
- **全功能控制与 HUD**：支持全键盘自由驾驶（WASD / 转向 / 刹车）、Tesla 极简玻璃 Dock 仪表盘、全景导航路线小地图、3秒候选轨迹扇面透视与追焦/第一人称/鸟瞰三重视角。

---

## 🧠 双脑解耦架构 / Architecture

```
                      [ 传感器感知输入 / Perception Sensors ]
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
                 ▼ (结构化遥测数据流 <15ms)                         ▼ (高维图像/环境语义 500ms+)
  ┌──────────────────────────────┐                ┌──────────────────────────────┐
  │  System 1: Jev 反射引擎       │                │  System 2: 宏观策略大模型     │
  │  (TypeSafe Reflex Engine)    │◄─── 异步指导 ──│  (Strategic VLM / LLM)       │
  │  - ADAPTIVE_CRUISE           │   (Async S2)   │  - 路线目标 / 出口规划         │
  │  - LANE_CHANGE_LEFT/RIGHT    │                │  - 复杂天气 / 风险评估         │
  │  - SWERVE_EVADE              │                └──────────────────────────────┘
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │   🛡️ AI 安全闸 (Safety Gate)  │ ◄── TTC 物理临界监控 (TTC < 1.6s)
  │   - 强制截断异常指令           │
  │   - 100% 全负荷线控制动       │
  └──────────────┬───────────────┘
                 │ (零等待线控执行量: Throttle, Brake, Steering)
                 ▼
  [ Three.js 物理动力学驱动底盘 / Drive-by-Wire Kinematics ]
```

---

## ⚡ 性能对比：传统大模型 vs Jev 安全闸

下表对比自车在高速 120 km/h（33.3 m/s）面对突发静止故障车时的制动反应数据：

| 架构类型 | 决策延迟 (Latency) | 盲区反应距离 ($d_{\text{reaction}}$) | 极限刹停总距离 | 避碰结果 |
| :--- | :--- | :--- | :--- | :--- |
| **端到端大模型 (VLM 单脑)** | **500 ms** | **16.7 米** (无制动盲冲) | 79.2 米 | 💥 剧烈追尾碰撞 |
| **人类驾驶员正常反应** | **1200 ms** | **40.0 米** | 102.5 米 | 💥 致命碰撞 |
| **Jev 智驾安全闸 (System 1)** | **10 ms** | **0.33 米** (瞬间施压) | **62.8 米** | 🛡️ **安全刹停 / 紧急变道** |

> **核心收益**：Jev 将反应距离削减了 **98%**，将原本必撞的工况转化为从容可控的紧急避险。

---

## 🚀 快速开始 / Quick Start

### 1. 本地运行

```bash
# 克隆仓库
git clone https://github.com/manhua-man/jev-pilot-reflex.git
cd jev-pilot-reflex

# 安装依赖
npm install

# 启动本地 3D 仿真器
npm run dev
```

浏览器打开 `http://localhost:5173` 即可体验！

### 2. 仿真控制与交互按键

- `🤖 Jev 智驾托管`：一键开启 / 关闭 Jev 自动巡航 (快捷键 `J`)。
- `🛣️ 高速分岔导航预选`：在右上角 HUD 点击 `[ ↖ 机场快速路 ]` 或 `[ ↗ 金融街 CBD ]`，动态切换路线意图，联动 3D 车辆琥珀色转向灯闪烁与 4 车道规划流形平顺变道汇流。
- `⚡ 模拟鬼探头 (AEB 避险)`：突发盲区行人以 5.2 m/s 全速横穿车道 (快捷键 `E`)，Jev 1.5ms 安全闸闭环识别 TTC < 1.6s 瞬间下达 `-8.5 m/s²` 极限满刹，轨迹光带变红并弹出全屏 AEB 警报！
- `✨ 双脑遥测监视器`：开启 / 收起 System 1 快思考 (60Hz · 1.5ms) 与 System 2 慢思考 (1.5Hz · 650ms) 异步协同面板 (快捷键 `B`)。
- `🎥 切换视角`：在 **CHASE**（追随视角）、**HOOD**（车头主视角）与 **TOP**（上帝鸟瞰）之间循环切换 (快捷键 `C`)。
- `? 快捷键帮助`：查看完整键位映射。手动驾驶模式下：`W` / `S` 控制油门与刹车，`A` / `D` 转向，`SPACE` 机械脚刹。

---

## 🗺️ 演进路线与版本规划 / Roadmap

- [x] **V1.0 - 具身智驾最小闭环 (Embodied MVP)**
  - 基于 Three.js 的高保真 3D 具身仿真环境与物理动力学
  - 本地离线高并发 Jev Reflex 推理求解器（1.5ms 零网络延迟，无需 API Key）
  - 15 条物理流形候选轨迹采样、安全打分与阿克曼转向闭环控制
  - Tesla 极简磨砂玻璃 HUD 仪表盘与实时导航小地图

- [x] **V2.0 - 高速双向 4 车道与 Y 型立体分岔枢纽 (4 Lanes & Y-Bifurcation)**
  - 全路段拓宽至双向 4 车道（全宽 18.4m，中央双黄实线，行车道白色虚线，路缘停止线与人行斑马线）
  - 高等级高速公路 Y 型分流枢纽（Y-Bifurcation）、双向绿色反光门架路牌、分流斑马线导流岛与高反光缓冲防撞桶群
  - 全新流线型 Tesla Model Y 3D 车辆模型（车轮物理自转与阿克曼转向挂载联动）

- [x] **V3.0 - 高价值博弈场景与双脑解耦遥测 (Game-Theory & Dual-Brain Monitor)**
  - **分岔路主动导航意图变道 (Fork Divergence)**：支持 `[ ↖ 机场快速路 ]` 与 `[ ↗ 金融街 CBD ]` 实时自选，联动车辆 3D 琥珀色前后转向灯与 HUD 指示灯，Jev 规划最优车道变道与汇流
  - **极端盲区鬼探头毫秒级 AEB (Blind-Spot AEB)**：一键模拟行人全速横穿车道，Jev 1.5ms 闭环识别 TTC < 1.6s，瞬时下发 `-8.5 m/s²` 极限安全刹车阻断，轨迹光带转为红光闪烁，触发浮动 AEB 紧急制动警报徽标
  - **System 1/2 双脑解耦遥测监视器 (Dual-Brain Inspector)**：
    - `System 1 (Jev Reflex)`: 60Hz · 1.5ms 物理流形、TTC、阿克曼转角、制动阻尼、100% 物理兜底安全闸状态
    - `System 2 (VLM World Model)`: 1.5Hz · 650ms 异步多模态场景语义理解、长程战略决策规划与进度条联动，即便大模型推理抖动或网络超时，底层 1.5ms 安全闸永不宕机

- [ ] **V4.0 - 动态恶劣气象与多模态空间声场 (Dynamic Weather & Spatial Audio)**
  - 动态雨雪雾极端天候（视距骤降、路面附着力物理系数降低，检验 Jev 防御性加减速）
  - Web Audio 空间声效（引擎电机声浪、高速风噪、转向灯蜂鸣、AEB 紧急制动刺耳警报音效）
  - 复杂夜间模式与动态远近光灯照明遮蔽

---

## 📦 类型契约 / Typed Contracts

Jev 核心仅依赖确定性类型遥测，杜绝非结构化文本解析所带来的不可预测性：

```typescript
export type JevReflexAction =
  | 'ADAPTIVE_CRUISE'   // 巡航加速保持
  | 'FOLLOW_LEAD'       // 保持稳定时距跟车
  | 'DECELERATE'        // 平缓降速
  | 'LANE_CHANGE_LEFT'  // 向左超车/变道
  | 'LANE_CHANGE_RIGHT' // 向右安全回道
  | 'EMERGENCY_BRAKE'   // 安全闸紧急制动 (Brake = 1.0)
  | 'SWERVE_EVADE';     // 动力学紧急避险借道

export interface ReflexDecision {
  action: JevReflexAction;
  confidence: number;       // 0.0 ~ 1.0
  latencyMs: number;        // < 15ms
  throttle: number;         // 0.0 ~ 1.0
  brake: number;            // 0.0 ~ 1.0
  targetLaneIndex: 0 | 1 | 2;
  safetyGateIntervened: boolean;
  overrideReason?: string;
}
```

---

## 🌐 线上体验与技术文章

- **在线交互 Demo 与深度长文**：[https://manhua777.site/jev-pilot-reflex](https://manhua777.site/jev-pilot-reflex)
- **技术博客**：《大模型开不好车：为什么智驾必须要有 Jev 这种“毫秒级 AI 安全闸”？》

---

## 📚 外部参考与生态致谢 / References & Ecosystem

本项目是在研究与吸纳 Jev 开源生态前沿思想的基础上，从零独立手写实现的完整闭环工程。特别致谢以下开源项目与行业深度分析：

1. **[standardagents/jevpilot](https://github.com/standardagents/jevpilot)**  
   *A playable Three.js driving simulator with Jev-powered autopilot.*  
   开源社区首个基于 Three.js 的 Jev 自动驾驶模拟器，为本项目在车道环境与 Jev 结构化动作调度方面提供了重要启发。

2. **[khordoo/jev-reflex-autonomy-lab](https://github.com/khordoo/jev-reflex-autonomy-lab)**  
   *Multi-drone autonomy lab demonstrating TypeSafe Jev reflex decisions with optional System 2 strategy guidance.*  
   Mahmood Khordoo 打造的多无人机蜂群自主实验室，奠定了 System 1（反射小脑）与 System 2（宏观策略）双脑异步解耦的工程基石。

3. **[AI应用新方向：Jev智驾决策，智驾系统“AI安全闸”](https://www.jiuyangongshe.com/a/4ep72l0l5b8)** (韭研公社)  
   深入剖析了端到端大模型在智驾领域的“推理时延墙”痛点，系统性论证了 Jev 作为毫秒级“AI 安全闸”不可或缺的物理与商业价值。

4. **社区精选资源**：
   - **`awesome-jev-zh`**：Jev 中文社区生态、开源应用与实践论文精选。
   - **`awesome-jev`**：全球 TypeSafe Jev 生态项目与开源工具大全。

---

## 📄 开源许可证 / License

本项目基于 [MIT License](LICENSE) 开源。欢迎 Star、Fork 并提交 PR 共建 Jev 具身智能生态！
