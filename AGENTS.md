# catrace-plugin — Agent Guide

多插件 monorepo，每个插件一个目录（当前活跃：`agent-notify/`）。

## 知识沉淀

- **插件相关的知识写本仓库 `.agent/`**：feature 子文档放 `.agent/features/<插件id>/`（文件名用大白话，入口叫 README.md），devlog 放 `.agent/devlog/`（日期前缀），每次增删后更新 `.agent/manifest.yaml`
- 宿主侧知识写主仓 `.agent/`，两边不要混。判断标准：只在这个插件成立 → 这里；涉及宿主多模块 → 主仓
- 现有知识入口：[.agent/manifest.yaml](.agent/manifest.yaml)

## 提交约定

- **PR 使用中文**：创建或更新 Pull Request 时，标题和描述均用中文撰写。
- **用户点名才 commit**：改动先落工作区，等用户验证效果并明确说「提交」再 commit；不要每轮微调各提一笔，同类迭代合并成一笔
- **`manifest.version` 用「年月日」**（本仓库约定，例 `2026.10.08`）：改了哪个插件就把它的版本号改成改动当天，同一天再改加第 4 位（`2026.10.08.1`）。宿主按 `.` 切数字逐段比"严格大于"才覆盖已装插件，**相等不覆盖** ⇒ 改了必须 bump。细则见 [SKILL.md](SKILL.md) §3 / §7
- 本仓库 commit 后，到主仓 `git add tools/plugin-demo` 更新 submodule 指针（两边分开提交，默认不 push）
