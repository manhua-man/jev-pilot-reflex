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

**JevPilot Reflex** 是一套基于 **TypeSafe Jev 毫秒级类型化决策** 与 **System 1 / System 2 双脑解耦架构** 的开源 3D 驾驶仿真实验室：
- **System 1 (Jev 反射小脑)**：直接摄取结构化类型遥测（车速、前车距离、车道偏移、盲区速度、TTC），在 **< 15 ms** 内输出确定性动作。
- **AI 安全闸 (Safety Brake)**：基于动力学 TTC（Time To Collision）对执行机构实施硬件级仲裁；无论上层大模型给出何种策略，一旦跌破临界 TTC（1.6s），瞬间强行接管线控并施加 100% 减速！
- **System 2 (宏观策略大脑)**：异步慢速推理（500ms+），仅在置信度下降或长程路径变动时给出战略建议，**绝不阻塞 60 FPS 主控循环**。

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

### 2. 仿真控制按键

- `🤖 Jev 智驾托管`：一键开启 / 关闭 Jev 自动巡航。
- `⚠️ 突发障碍物入侵`：在当前自车车道前方 32 米处直接投放突发静止重型货车，触发 AI 安全闸毫秒级介入！
- `⚡ 前车紧急切入`：模拟邻道慢车突然变道侵占路权，触发 Jev 紧急避险变道 (`SWERVE_EVADE`)。
- `🎥 切换视角`：在 **CHASE**（追随视角）、**HOOD**（车头主视角）与 **TOP**（上帝鸟瞰）之间循环切换。
- 手动驾驶模式下：`W` / `S` 控制油门与刹车，`A` / `D` 切换车道。

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

## 📄 开源许可证 / License

本项目基于 [MIT License](LICENSE) 开源。欢迎 Star、Fork 并提交 PR 共建 Jev 具身智能生态！
