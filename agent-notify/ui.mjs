/** Agent notify toast — one card per sessionId; optional debug dump. */
const { h } = globalThis.__CATRACE_VUE__ || {}
if (typeof h !== 'function') throw new Error('Catrace plugin Vue runtime missing')

const STYLE_ID = 'catrace-plugin-agent-notify-css'
const CSS = `
.agent-toast {
  display: flex; flex-direction: column; width: 100%; min-height: 0;
  font-family: system-ui, -apple-system, Segoe UI, sans-serif;
}
.agent-toast .header {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 0.5rem; margin-bottom: 0.375rem; min-height: 1.25rem;
}
.agent-toast .header-left {
  display: flex; align-items: center; gap: 0.5rem; min-width: 0; flex: 1;
}
.agent-toast .agent-badge {
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto; width: 2rem; height: 2rem; border-radius: 0.625rem;
  color: #ffffff; font-size: 0.75rem; font-weight: 800; letter-spacing: -0.02em;
}
@keyframes an-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}
.agent-toast .title {
  flex: 1; min-width: 0; margin: 0; font-size: 0.9375rem; font-weight: 700;
  color: var(--title); line-height: 1.3; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.agent-toast .close-btn {
  width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; color: #9C8DB5; cursor: pointer;
  border-radius: 0.375rem; padding: 0; flex-shrink: 0;
}
.agent-toast .close-btn:hover { background: var(--light-bg); color: var(--accent); }
.agent-toast .meta-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; margin-bottom: 0.375rem;
}
.agent-toast .chip {
  display: inline-flex; align-items: center; max-width: 100%; height: 1.25rem;
  padding: 0 0.4375rem; border-radius: 0.25rem; font-size: 0.6875rem; font-weight: 600;
  line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.agent-toast .project-chip {
  background: rgba(15, 23, 42, 0.06); color: #334155;
  border: 0.0625rem solid rgba(15, 23, 42, 0.08);
}
.agent-toast .project-chip.muted { color: #94a3b8; font-weight: 500; }
.agent-toast .event-chip {
  background: var(--badge-bg); color: var(--badge-fg); border: 0.0625rem solid var(--border);
}
.agent-toast .sid {
  font-size: 0.625rem; color: #94a3b8; font-family: ui-monospace, Menlo, Consolas, monospace;
  word-break: break-all;
}
.agent-toast .body-text {
  font-size: 0.75rem; color: var(--body); line-height: 1.45; margin: 0 0 0.375rem 0;
  word-break: break-word; cursor: pointer;
  overflow-y: hidden; overflow-x: hidden;
  max-height: 3.3rem;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  transition: max-height 0.2s ease;
}
.agent-toast .body-text.is-expanded {
  display: block; -webkit-line-clamp: unset;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}
.agent-toast .body-text.is-expanded::-webkit-scrollbar { width: 0.375rem; }
.agent-toast .body-text.is-expanded::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.agent-toast .body-toggle {
  display: flex; justify-content: flex-end; margin: 0 0 0.375rem;
  color: var(--accent); font-size: 0.6875rem; font-weight: 600; cursor: pointer;
}
.agent-toast .hint-row { display: flex; justify-content: flex-end; margin-bottom: 0.5rem; }
.agent-toast .goto-hint { font-size: 0.6875rem; color: var(--accent); opacity: 0.85; font-weight: 600; }
.agent-toast .dump-wrap,
.perm-card .dump-wrap {
  margin: 0.5rem 0 0.625rem;
  border: 0.0625rem solid #dedede;
  border-radius: 0.625rem;
  overflow: hidden;
  background: #ffffff;
  box-shadow: none;
}
.agent-toast .dump-bar,
.perm-card .dump-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  min-height: 1.875rem; padding: 0.125rem 0.5rem 0.125rem 0.625rem;
  background: #f7f7f7;
  border-bottom: 0.0625rem solid #e5e5e5;
  cursor: pointer;
  transition: background 0.15s ease;
}
.agent-toast .dump-toggle,
.perm-card .dump-toggle {
  display: inline-flex; flex: 1; align-items: center; gap: 0.3rem;
  border: none; background: transparent; color: #475569;
  font-size: 0.6875rem; font-weight: 700; cursor: pointer; padding: 0.25rem 0;
  text-align: left;
}
.agent-toast .dump-arrow,
.perm-card .dump-arrow { width: 0.625rem; color: #94a3b8; font-size: 0.6875rem; line-height: 1; }
.agent-toast .dump-tools,
.perm-card .dump-tools { display: flex; align-items: center; gap: 0.375rem; }
.agent-toast .dump-tabs,
.perm-card .dump-tabs {
  display: flex; gap: 0.0625rem; padding: 0.0625rem;
  border-radius: 0.3125rem; background: #e9e9e9;
}
.agent-toast .dump-tab,
.perm-card .dump-tab {
  border: none; border-radius: 0.25rem; height: 1.25rem; padding: 0 0.4375rem;
  font-size: 0.625rem; font-weight: 700; cursor: pointer;
  background: transparent; color: #8a8a8a;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.agent-toast .dump-tab.is-on,
.perm-card .dump-tab.is-on {
  background: #ffffff; color: #475569;
  box-shadow: 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.1);
}
.agent-toast .dump-copy,
.perm-card .dump-copy {
  position: static; height: 1.25rem; padding: 0 0.5rem;
  border: 0.0625rem solid #d6d6d6; border-radius: 0.3125rem;
  font-size: 0.625rem; font-weight: 700; cursor: pointer;
  background: #ffffff; color: #64748b;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.agent-toast .dump-fields,
.perm-card .dump-fields {
  margin: 0; max-height: 14rem; overflow-y: scroll; overflow-x: hidden;
  padding: 0.25rem 0.625rem 0.5rem;
  scrollbar-gutter: stable; scrollbar-width: thin;
  background: #ffffff;
  color: #1e293b;
  -webkit-user-select: text !important;
  user-select: text !important;
  cursor: text;
  pointer-events: auto !important;
}
.agent-toast .dump-fields *,
.perm-card .dump-fields * {
  -webkit-user-select: text !important;
  user-select: text !important;
  cursor: text;
}
.agent-toast .dump-row,
.perm-card .dump-row {
  padding: 0.4rem 0;
  border-bottom: 0.0625rem solid #e2e8f0;
}
.agent-toast .dump-row:last-child,
.perm-card .dump-row:last-child { border-bottom: none; }
.agent-toast .dump-key,
.perm-card .dump-key {
  font-size: 0.625rem; font-weight: 700; letter-spacing: 0.02em;
  color: #2563eb; margin-bottom: 0.15rem;
}
.agent-toast .dump-val,
.perm-card .dump-val {
  font-size: 0.75rem; color: #1e293b; line-height: 1.45;
  white-space: pre-wrap; word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.agent-toast .dump,
.perm-card .dump {
  margin: 0; max-height: 14rem; overflow-x: hidden; overflow-y: scroll;
  padding: 0.5rem 0.625rem; border-radius: 0;
  background: #0f172a; color: #e2e8f0;
  font-size: 0.6875rem; line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap; word-break: break-word;
  -webkit-user-select: text !important;
  user-select: text !important;
  cursor: text;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #94a3b8 #f8fafc;
}
.agent-toast .dump-fields::-webkit-scrollbar,
.perm-card .dump-fields::-webkit-scrollbar { width: 0.5rem; }
.agent-toast .dump-fields::-webkit-scrollbar-thumb,
.perm-card .dump-fields::-webkit-scrollbar-thumb {
  background: #94a3b8; border-radius: 999px;
}
.agent-toast .dump-fields::-webkit-scrollbar-track,
.perm-card .dump-fields::-webkit-scrollbar-track { background: #f8fafc; }
.agent-toast .dump::-webkit-scrollbar-thumb,
.perm-card .dump::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.7); border-radius: 999px;
}
.agent-toast .dump::-webkit-scrollbar-track,
.perm-card .dump::-webkit-scrollbar-track { background: rgba(15, 23, 42, 0.4); }
.perm-card .dump-wrap { position: relative; margin-top: 0.5rem; }
.perm-card { display: flex; flex-direction: column; width: 100%; font-family: system-ui, sans-serif; }
.perm-card .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.375rem; }
.perm-card .header-left { display: flex; align-items: center; gap: 0.5rem; }
.perm-card .pulse-dot {
  width: 0.5rem; height: 0.5rem; border-radius: 50%; background: #f59e0b;
  animation: an-pulse 1.2s ease-in-out infinite;
}
.perm-card .title { margin: 0; font-size: 0.875rem; font-weight: 700; color: #92400e; }
.perm-card .project { font-size: 0.6875rem; color: #b45309; }
.perm-card .tool-block {
  background: #fffbeb; border: 0.0625rem solid #fde68a; border-radius: 0.375rem;
  padding: 0.5rem 0.625rem; margin-bottom: 0.625rem;
}
.perm-card .tool-name {
  font-size: 0.75rem; font-weight: 700; color: #92400e; background: #fef3c7;
  border-radius: 0.25rem; padding: 0.0625rem 0.375rem;
}
.perm-card .tool-summary { font-size: 0.75rem; color: #b45309; margin: 0.25rem 0 0; font-family: ui-monospace, monospace; word-break: break-all; }
.perm-card .actions { display: flex; flex-wrap: wrap; gap: 0.375rem; }
.perm-card .btn { border: none; border-radius: 0.375rem; height: 1.75rem; padding: 0 0.625rem; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
.perm-card .btn-allow { background: #059669; color: #fff; }
.perm-card .btn-deny { background: #fee2e2; color: #991b1b; }
`

const EVENT_LABEL = {
  SessionStart: '会话开始',
  UserPromptSubmit: '开始思考',
  PreToolUse: '调用工具中',
  PostToolUse: '工具调用完成',
  PostToolUseFailure: '工具调用失败',
  Stop: '任务完成',
  StopFailure: '任务出错 / 异常',
  Notification: '等待交互',
}
const EVENT_BODY = {
  SessionStart: '会话已开始',
  UserPromptSubmit: '正在处理你的请求',
  PreToolUse: '正在调用工具',
  PostToolUse: '工具调用完成',
  PostToolUseFailure: '工具调用失败',
  Stop: '本轮任务已完成，等你继续',
  StopFailure: '执行中断，请查看终端',
  Notification: '需要你回来看一眼',
}
const EVENT_THEMES = {
  PostToolUseFailure: { accent: '#EF4444', title: '#991B1B', body: '#B91C1C', lightBg: '#FECACA', border: '#FECACA', badgeBg: '#FEE2E2', badgeFg: '#B91C1C' },
  StopFailure: { accent: '#EF4444', title: '#991B1B', body: '#B91C1C', lightBg: '#FECACA', border: '#FECACA', badgeBg: '#FEE2E2', badgeFg: '#B91C1C' },
  Stop: { accent: '#06B6D4', title: '#0F172A', body: '#475569', lightBg: '#CFFAFE', border: '#A5F3FC', badgeBg: '#CFFAFE', badgeFg: '#0E7490' },
  Notification: { accent: '#8B5CF6', title: '#0F172A', body: '#475569', lightBg: '#E9D5FF', border: '#DDD6FE', badgeBg: '#EDE9FE', badgeFg: '#6D28D9' },
  SessionStart: { accent: '#10B981', title: '#0F172A', body: '#475569', lightBg: '#A7F3D0', border: '#6EE7B7', badgeBg: '#D1FAE5', badgeFg: '#047857' },
  UserPromptSubmit: { accent: '#6B7280', title: '#0F172A', body: '#475569', lightBg: '#E5E7EB', border: '#D1D5DB', badgeBg: '#F3F4F6', badgeFg: '#4B5563' },
  PreToolUse: { accent: '#F59E0B', title: '#0F172A', body: '#475569', lightBg: '#FEF3C7', border: '#FDE68A', badgeBg: '#FEF3C7', badgeFg: '#B45309' },
  PostToolUse: { accent: '#14B8A6', title: '#0F172A', body: '#475569', lightBg: '#CCFBF1', border: '#99F6E4', badgeBg: '#CCFBF1', badgeFg: '#0F766E' },
}

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function themeOf(event) {
  return EVENT_THEMES[event] || EVENT_THEMES.Stop
}

function themeStyle(t) {
  return {
    '--accent': t.accent,
    '--title': t.title,
    '--body': t.body,
    '--light-bg': t.lightBg,
    '--border': t.border,
    '--badge-bg': t.badgeBg,
    '--badge-fg': t.badgeFg,
  }
}

function projectName(cwd) {
  if (!cwd) return ''
  const parts = String(cwd).replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

const AGENT_BADGES = {
  claude: { label: 'Cl', name: 'Claude', color: '#D97757', icon: "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" },
  zcode: { label: 'Z', name: 'ZCode', color: '#1C1C1E', img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAzdSURBVHhe7Vx7rBTVGd8589j3zntm7+VewfTqVatVuNVqrMVHpcBtbROFVuu79SIktVaItDFUEF+1olKpptFirf5ha6zBP6xVMREf2NSgwUR8lBg1+Chw0yp/qAmc5juzs8x+O7N39+xZuMj8kl9m5syZ7/H79px53pvJpEiRIkWKFClSpEiRIkWKLw/6+/ttp79/uuP7o261epHj913h+v5Sx6suc31/uev717m+f73r+yv3snqD41VvcrzqjY5Xvdnxqrc4XvU3sHR9/9Z2GT0uYu8msN/oj/mHOJbX4lrq+P4VQbz+qOv2HzcwMGDh3CYtPK//JK/KEn3R9avjbrWPetU+6vf1H3CEuF0fWN3p+dUXoHi+75+Ac54UcKvVsyHIUGxYBglUD3iGudTz8vue9bz+s7AG+wWu6w65vv94g+CeTx3PZ8u26O9d1o8L2/B6jfvNfqQgrl9dZ1SrU7Em+wy2553lev44BAMBH2ys5f0f03W/g7XpOWzXvSAcojiwg4k1DXa7bvUcrFHP4Pj+d/dONV6E0e2kdbyN16OMHhPXN24db+N10fa9cMrabXveGVgr4fB9/1DH8/8HQdiul0gnpk0kJ5t9VhTX2+E4Th/WTCgs130afv04gJQem44s112HNRMG2/N+MNEvv5luTJtITi77oI/leWdi7YTActyXYc6zHTdlAlkBbPdZrF3XMD3vJKiw5bgpW5AVwvWo4XnHYA27gmW7q2yobozTlI0EnUzbXo417Aqm47wM86HlOMm0WyzD9bj+7TLObriMsxXX1opxdsNlnK24Nsdh5w3LtsVNQ57n+aZlf9oQTMpkOi6MgO2WZVWwllywLOsbYNhM2RlN82isJRd0yzobfv2mbadsk2wkWNYsrCUXTNNcwApg2VzUDZOWypX2WElYb8GKbjT4K1f0pj6xNtuwD7HjfNohFMAwjPOwllzQTftqZjDGETCuPWwzTItdG08ZHKT9A43s65/SNcHOIVOnUd202LDPF0vsMULflIGmvp1y8JCpzD4UoZ5PhEk5A4MC2AuxllwwLOtaSC5wbCFGg2puk4hML7zoIvrRRx/RDz/8sIEffPAB3batO27fsYOeM28+VTWNKqpGjz7ma/TNN9/s2jYc/+6779LpM0ZoLl+IyTlJh2Ab9NJN8yqsJRd007yBFcC0AoZOw+0WzGQy9PKFi2ivsG7dOqqoKi2WylTVsvT5F57HXbixYsV1NJORGnOK5p2kASuATSum+UusJRd0w7g5nE46JRTgsrEFODcheO+996jnV9kvFPxct3Il7sKNp9evp0RW2PkE59QOQa+KYVyDteRCxTBugeEF82yn7GUB5o6Osl+oRAideeppdPfu3bgLF8bHx+lXhobYiIJfM86pHdYKsAxryYWKrt8RFMDsmFCABZdfjnPsGqtW3cZs5wpFapgmfeutt3AXbpx/wYXMdiB+JB+jOb8kwrEVw/g11pILum7+HoYVC6BDSpJEL7n0Urpr1y4h/Pjjj+mdd66h+XyBFkolJtTatfdhDbnx5wceYDbh0hbn0glBL2EFKOvGXbwFKOs69at99LDDh4VwysAgzUiEXaODUD8691ysITe2bt0Kz3DYOQXn0SkFF0C/G4ZVxTA6JgRTLFdoNpen2XyN0fUOmS8WmV247Jw6bRrdvn071pELe/bsoaef8W1WVN5co4TzgPgC6MakIBQ0I0n0iSf+gXXkxo033lSfekSQ6VURWQBjkhTACE7si5cswRpy46WXXqKalqWFYqnZHyeZXuILoLM5HRg4gmVrBn3bZ0v7hsHm/xkjX6efffYZ1pELcGL/6tHHUCLLwfQREw9ua8Uw/qAAFUEFKOt3Q3ChccZKDKPtSet4G68n2dd1dnKEq59XXnkV68iNhYsW1aeeplji1vE2Xq8R9CoJLQAEiEXZxwShbr/9DqwhNx599FFmEx5jYF/dEvQSVoBiuYwKUGly2Mjoftw3bl+rPsHQBqHmzB3FGnIDHrZV+/rZ1VSlwTf23yq25PiFFwCGFXt+zpzVnqX3iFH7sA4iuZ5H33//fawjN7531vdZUaN5iSIrSGBXYAFaveToIcO73b8+/DDWkBt3rlkTTD0x/kSR6VU6wAsAPkGon/z0MqwhN1577TVaKBZpNpdr8ieSYgtQhAKA4fI+I/iDp5zDw8P0k08+wTpy4YsvvqDHn3BCMPX0OB9mv1QSVwCoKlwtNLEc0yaAuXyeyrJCn3tO3AuWq5curU09EV89ih/0KogqQKFYTC5AjwhCXbt8OdaQG0899TR7fAH3EthXL9iDAoDhUs8JfkD8b55yitAXLNOmHUoJkZl97LMXBD9CCxAM1WZHIeE5Sn07XI+2xfWL6QOXnOVyhb1YF4VzzzuvfsOF44mNq4v491JkAQrFu5nBYhBAr5gvFJlQ99x7L9aQG3+6/35mE2xjf70k06sgtABgGJJI4kT7WxPsg1DnzJuHNeTGv7dupbphsK8mJo5vov2dkeklrgCFNgrAz2KxSAkhdGBgUOgLlpmnnlqbenoXexKDAhTEFCBXKNwFvxAYxmwo1xhuh21x29H28DhMeEMGQj3++N+xjtxYef319aknKY64ePF23HFR4v71fjCiBBZgDVQ1cFCoMWk93A7boonF9Qnm/Z9feSXWkBsbN26ksqKwlyzNccTFnBRbO/HHb7ORIL4A0QC6J9gE8Y899jihL1iOOPJIZrcXMbdL8J0TVoBc4XesuvBCBBzUXow0MHSO23C/yD5V1aiWzdJNmzZhHbkxNragNvXE+GwVU6fxJzE8piC0ALnVYBjuIoWxNu/feusqrCE3Hnnkb8ymls01+9vHZHrlhBcgL4aF4FvOWbNmYQ25sW3bNvbOAB7gNfnbDxRagGwudxsMK+yEl3DJCR9Awce1ojB3LnwnmmHDn/nJNfsVygnsszhyOXEFqDvtkjDng1APPfQXrCE3Vq9ezWxmYeqJ8blfyPQSVYBsfhUYhJcY3RKEuviSS7CG3Ni8eTMkGlx21oorinAHzb7ii8ljIgouQPa3UFXspCPmg5MufPYt8gXL9BkzmF2Y+2F5+PAwPW76dCGEaVLTtOZc2mAwEgQWoG48y0dFUdmX0hs2bMA6cmPx4iVMdDinwCfq6x57jH7++ee4Gzdmz5nD7ONcEhnVhxVBdAGyWTbMYRlHvC/cDqeGZcuW4Ry58eSTTwbiyzJbwiWoaMyZM7dWgObckljvl8tRTVQBVChANseM8xCSOPHEk4S9YNm5cycdHBysz9VjY2O4ixDMnj2b2cf5tEOml8AC3IwdTEgtWML0AE8733jjDZwfN+bPn18XH17aw+OHXqBeAMillk89t+h2EjVNzN+IqWr2hprBmnNYJjEMUKOqGsz7Dz74IM6NG2vXrq3P+6VSiV0F9Qqj7G/QwgI05pasRYNOv8JackFV1eVgEF4XRhk6jW5H94P4J598Mn377bfp66+/3hW3bNlC1z/zDHxxzOyGf/r0zjvvNPUVwi1b2Htp8IPzboc1bRZjLbmgadpS7KBdwstpGD1wTd0t2bQTEYR9tqjCH2g39xVBsI3z6YRKNrsIa8kFRVEWMaMQUIdUFIVNF/BFQreE74SitmEb9xFJuHTG+bRNppd6AdaSC6qq/hDm85SdUdO0UawlFxQl9y08PFNOyD2qqo5gLbmQzWanKYqyC4ZkA8ERbuNlnK24Nl7G2Ypr42WTLWVHsVj0sZZcGMlkVFmWX4X5PGV7lGX5xUwmI2EtuSHL8l3YScpkyrJ8C9awK8iyPBce+XZFOaZNJCeRfUVRZmINu0VRluXNLAhGuCzsFQ9k++zS+J9DQ5ksFrBrEELGmh2mxCSEnI+1EwLXdUuEkI3MSegsgSL2tdsPs9197fbDTNpXE389fMeAtRMGRVFOIYR8Gtwtwh1uyPAOMmm7FfFxeH+cPbzdivg4vD/OHt5uxXrfcUVRjseaCQchZGFzEAc9dxNCLsZa9QQjIyMqIeSamCAOVoL4V82cOVPBWvUMAwMDeULIzyRC/gsvxBmlkMH/cWtuj7bBI2XUFu0f9sHtk86+tAMuToaGhsRf9UwEcCrL8hxJkjaEz+gPMj4jy/KZRx11lIa12WeAYQfPigghSyRJ2hQT5JeR/yKEXJnL5Q6ZN2+ejDXZL4ApSdO0YTgRSZJ0nyRJr0qSNB4T/IFIyOMVSZL+SAi5UNO0wyBfrMF+B6VUgmmpUqlYmqYdIcvy6XBTQgj5hSRJKyRJWiVJ0hpJkv4gSdI9kNAkIsQDcUF8EOcKiJsQ8mNZlk+DHxfkVZvrxT1k6yVgeoL5EX4tvu8Xbdsum6ap67pu6LoOK5ONBsQHccJNJ8QN8e/Tq5sUKVKkSJEiRYoUKXqP/wMZh4kaF0tDggAAAABJRU5ErkJggg==' },
  codex: { label: 'Cx', name: 'Codex', color: '#10A37F', icon: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" },
  gemini: { label: 'G', name: 'Gemini', color: '#4285F4', icon: "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" },
  kimi: { label: 'K', name: 'Kimi', color: '#334155', icon: "M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441" },
}
function agentBadge(agentId) {
  return AGENT_BADGES[String(agentId || '').toLowerCase()] || { label: 'AI', name: 'AI', color: '#64748B' }
}

function stripMarkdown(text) {
  return String(text)
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
}

// body 常是 assistant 回复的 markdown 原文：取首个自然段再去掉标记符号
function bodyPreview(entry) {
  const fallback = EVENT_BODY[entry.event] || '状态已更新'
  const raw = entry.message || fallback
  const firstPara = String(raw).split(/\r?\n\s*\r?\n/).find((s) => s.trim()) || ''
  return stripMarkdown(firstPara).trim() || fallback
}

function toSnake(key) {
  return String(key).replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`).replace(/^_/, '')
}

function rawOf(event) {
  const p = (event && event.payload) || {}
  return p.raw || (p.entry && p.entry.raw) || null
}

function filterCommon(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const skip = new Set()
  for (const key of Object.keys(raw)) {
    const snake = toSnake(key)
    if (snake !== key && Object.prototype.hasOwnProperty.call(raw, snake)) skip.add(key)
  }
  const out = {}
  for (const key of Object.keys(raw)) {
    if (skip.has(key)) continue
    const val = raw[key]
    if (val === '' || val == null) continue
    out[toSnake(key)] = val
  }
  if (out.hook_event_name === out.event) delete out.hook_event_name
  const texts = ['last_assistant_message', 'response_preview', 'response_text']
  const first = texts.map((k) => out[k]).find((v) => typeof v === 'string' && v)
  if (first) {
    for (const k of texts) delete out[k]
    out.last_assistant_message = first
  }
  if (out.mode != null && out.permission_mode != null && out.mode === out.permission_mode) delete out.mode
  return out
}

const COMMON_SKIP = new Set(['response_preview', 'response_text', 'hook_event_name'])
const KEY_ORDER = [
  'event', 'last_assistant_message', 'cwd', 'session_id', 'timestamp',
  'permission_mode', 'state', 'tool_name', 'tool_call_count',
  'transcript_path', 'turn_id', 'trace_id', 'stop_hook_active',
]

function dumpObject(event, mode) {
  const raw = rawOf(event)
  if (mode === 'common') return filterCommon(raw)
  return raw
}

function dumpText(event, mode) {
  try {
    return JSON.stringify(dumpObject(event, mode) ?? { note: '没有收到 hook stdin' }, null, 2)
  } catch (err) {
    return String(err)
  }
}

function orderedKeys(obj) {
  const keys = Object.keys(obj || {})
  const head = KEY_ORDER.filter((k) => keys.includes(k))
  const rest = keys.filter((k) => !KEY_ORDER.includes(k)).sort()
  return [...head, ...rest]
}

function renderFields(obj, mode) {
  if (obj == null) {
    return h('div', { class: 'dump-fields' }, [h('div', { class: 'dump-val' }, '没有收到 hook stdin')])
  }
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    return h('pre', { class: 'dump' }, dumpText({ payload: { raw: obj } }, 'raw'))
  }
  const skip = mode === 'common' ? COMMON_SKIP : new Set()
  const keys = orderedKeys(obj).filter((k) => !skip.has(k))
  return h(
    'div',
    { class: 'dump-fields' },
    keys.map((key) => {
      const val = obj[key]
      const text = typeof val === 'string' ? val : JSON.stringify(val, null, 2)
      return h('div', { class: 'dump-row' }, [
        h('div', { class: 'dump-key' }, key),
        h('div', { class: 'dump-val' }, text),
      ])
    }),
  )
}

export default {
  name: 'AgentNotifyCard',
  props: {
    event: { type: Object, required: true },
    isHovered: { type: Boolean, default: false },
  },
  emits: ['close', 'action'],
  data() {
    return { copied: false, dumpMode: '', dumpExpanded: false, bodyExpanded: false }
  },
  created() {
    ensureStyles()
    const p = this.event && this.event.payload
    const v = p && p.debugView
    this.dumpMode = v === 'raw' || v === 'common' ? v : 'common'
    this.dumpExpanded = p && p.debugExpanded === true
  },
  methods: {
    copyDump() {
      const text = dumpText(this.event, this.dumpMode || 'common')
      const done = () => {
        this.copied = true
        setTimeout(() => {
          this.copied = false
        }, 1200)
      }
      const clip = plugin && plugin.clipboard && plugin.clipboard.writeText
      const p = clip ? clip(text) : navigator.clipboard.writeText(text)
      Promise.resolve(p).then(done).catch(() => {})
    },
    renderDump() {
      const p = (this.event && this.event.payload) || {}
      if (!p.debug && p.debugView !== 'common' && p.debugView !== 'raw') return null
      const mode = this.dumpMode || p.debugView || 'common'
      const controls = this.dumpExpanded
        ? h('div', { class: 'dump-tools' }, [
            h('div', { class: 'dump-tabs' }, [
              h('button', {
                class: ['dump-tab', mode === 'common' ? 'is-on' : ''],
                type: 'button',
                onClick: (ev) => { ev.stopPropagation(); this.dumpMode = 'common' },
              }, '常用'),
              h('button', {
                class: ['dump-tab', mode === 'raw' ? 'is-on' : ''],
                type: 'button',
                onClick: (ev) => { ev.stopPropagation(); this.dumpMode = 'raw' },
              }, '原始'),
            ]),
            h('button', {
              class: 'dump-copy',
              type: 'button',
              onClick: (ev) => { ev.stopPropagation(); this.copyDump() },
            }, this.copied ? '已复制' : '复制'),
          ])
        : null
      return h('div', { class: 'dump-wrap' }, [
        h('div', {
          class: 'dump-bar',
          role: 'button',
          tabindex: 0,
          onClick: () => { this.dumpExpanded = !this.dumpExpanded },
          onKeydown: (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault()
              this.dumpExpanded = !this.dumpExpanded
            }
          },
        }, [
          h('span', { class: 'dump-toggle' }, [
            h('span', { class: 'dump-arrow', 'aria-hidden': 'true' }, this.dumpExpanded ? '▾' : '▸'),
            '调试字段',
          ]),
          controls,
        ]),
        this.dumpExpanded ? renderFields(dumpObject(this.event, mode), mode) : null,
      ])
    },
  },
  render() {
    const event = this.event || {}
    const p = event.payload || {}
    const dump = this.renderDump()
    const isPerm = (event.eventType || event.event_type) === 'agent-notify.permission' || p.requestId != null

    if (isPerm) {
      const permEntry = p.entry || {}
      const permission = permEntry.permission || {}
      const permProject = p.projectName || permEntry.projectName || projectName(p.cwd || permEntry.cwd)
      return h('div', { class: 'perm-card' }, [
        h('div', { class: 'header' }, [
          h('div', { class: 'header-left' }, [
            h('div', { class: 'pulse-dot' }),
            h('h2', { class: 'title' }, '等待你批准'),
          ]),
          permProject ? h('span', { class: 'project' }, permProject) : null,
        ]),
        h('div', { class: 'tool-block' }, [
          h('span', { class: 'tool-name' }, permission.toolName || p.toolName || 'tool'),
        ]),
        h('div', { class: 'actions' }, [
          h('button', { class: 'btn btn-allow', type: 'button', onClick: () => { this.$emit('action', `allow:${p.requestId}`); this.$emit('close') } }, '允许'),
          h('button', { class: 'btn btn-deny', type: 'button', onClick: () => { this.$emit('action', `deny:${p.requestId}`); this.$emit('close') } }, '拒绝'),
        ]),
        dump,
      ])
    }

    const entry = p.entry || (Array.isArray(p.entries) ? p.entries[0] : null) || {}
    const sessionId = p.sessionId || entry.sessionId || ''
    const theme = themeOf(entry.event)
    const title = entry.sessionTitle || entry.projectName || projectName(entry.cwd) || 'AI 助手'
    const project = projectName(entry.cwd)
    const body = bodyPreview(entry)
    const badge = agentBadge(entry.agentId)

    return h('div', { class: 'agent-toast', style: themeStyle(theme) }, [
      h('div', { class: 'header' }, [
          h('div', { class: 'header-left' }, [
          h('span', { class: 'agent-badge', title: badge.name, style: { background: badge.color } },
            badge.img
              ? h('img', { src: badge.img, alt: '', style: { width: '100%', height: '100%', 'border-radius': 'inherit', display: 'block' } })
            : badge.icon
              ? h('svg', { viewBox: '0 0 24 24', fill: 'currentColor', width: '1rem', height: '1rem', 'aria-hidden': 'true' }, [h('path', { d: badge.icon })])
              : badge.label),
          h('h2', { class: 'title' }, title),
        ]),
        h('button', {
          class: 'close-btn',
          type: 'button',
          'aria-label': 'Close',
          onClick: (ev) => {
            ev.stopPropagation()
            this.$emit('close')
          },
        }, '×'),
      ]),
      h('div', { class: 'meta-row' }, [
        project && project !== title
          ? h('span', { class: 'chip project-chip' }, project)
          : !project
            ? h('span', { class: 'chip project-chip muted' }, '未知项目')
            : null,
        h('span', { class: 'chip event-chip' }, EVENT_LABEL[entry.event] || entry.event || ''),
      ]),
      dump,
      h('p', {
        class: ['body-text', this.bodyExpanded ? 'is-expanded' : ''],
        onClick: (ev) => {
          ev.stopPropagation()
          this.bodyExpanded = !this.bodyExpanded
        },
      }, body),
      h('div', { class: 'hint-row' }, [h('span', { class: 'goto-hint' }, '点击前往会话')]),
    ])
  },
}
