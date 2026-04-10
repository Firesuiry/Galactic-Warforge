# `automatic_piler` 仍暴露在目录中但不应作为公开可建入口

- 状态：已修复（见 T103 收口）
- 首次记录：2026-04-05
- 来源：`docs/player/已知问题与回归.md` -> `2026-04-05 戴森深度试玩补测 → 本轮问题收口结果`
- 类别：目录口径 / 建筑公开能力

## 问题描述

`automatic_piler` 曾在目录层可见，但并不构成真实可玩的公开建造入口，容易误导玩家和客户端实现。

## 实际现象

- 目录中保留过该建筑条目
- 但玩家不应把它视为稳定可建能力

## 收口后口径

- `/catalog.buildings[]` 仍可保留条目
- 但 `buildable = false`
- authoritative `build automatic_piler` 直接拒绝为 `building type not buildable`

## 影响

- 修复前会误导玩家、CLI 和文档把该建筑当作可玩入口

## 证据

- 该问题在 `2026-04-05 戴森深度试玩补测` 中作为“问题收口结果”记录
