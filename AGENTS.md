# catrace-plugin — Agent Guide

多插件 monorepo，每个插件一个目录（当前活跃：`agent-notify/`）。

## 知识沉淀

- **插件相关的知识写本仓库 `.agent/`**：feature 子文档放 `.agent/features/<插件id>/`（文件名用大白话，入口叫 README.md），devlog 放 `.agent/devlog/`（日期前缀），每次增删后更新 `.agent/manifest.yaml`
- 宿主侧知识写主仓 `.agent/`，两边不要混。判断标准：只在这个插件成立 → 这里；涉及宿主多模块 → 主仓
- 现有知识入口：[.agent/manifest.yaml](.agent/manifest.yaml)

## 提交约定

- **用户点名才 commit**：改动先落工作区，等用户验证效果并明确说「提交」再 commit；不要每轮微调各提一笔，同类迭代合并成一笔
- 本仓库 commit 后，到主仓 `git add tools/plugin-demo` 更新 submodule 指针（两边分开提交，默认不 push）
