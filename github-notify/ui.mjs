const React = globalThis.__CATRACE_REACT__;
if (!React?.createElement || !React?.useState)
    throw new Error('Catrace plugin React runtime missing');
const { createElement: h, useState, useRef, useEffect } = React;
const STYLE_ID = 'catrace-plugin-github-notify-css';
const CSS = `
.gh-card {
  display: flex; flex-direction: column; width: 100%; min-height: 0;
  --accent: #24292f; --title: #1f2328; --body: #656d76; --bg: #f6f8fa;
  --link: #0969da;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.gh-card .hdr { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.gh-card .left { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.gh-card .badge {
  flex-shrink: 0; padding: 0.1875rem 0.4375rem; border-radius: 999px;
  background: #ddf4ff; color: var(--link);
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.02rem;
}
.gh-card .title {
  margin: 0; font-size: 0.875rem; font-weight: 650; color: var(--title);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gh-card .x {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border: none; background: transparent;
  border-radius: 0.25rem; color: #94a3b8; font-size: 1.125rem; line-height: 1; cursor: pointer;
}
.gh-card .x:hover { background: var(--bg); color: var(--accent); }
.gh-card .bar {
  height: 0.125rem; border-radius: 999px;
  background: linear-gradient(90deg, #0969da, #ddf4ff);
  transform-origin: left center;
  animation: gh-card-shrink var(--toast-auto-hide-ms, 10000ms) linear forwards;
  margin: 0.35rem 0 0.5rem;
}
.gh-card .bar.paused { animation-play-state: paused; }
@keyframes gh-card-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.gh-card .snippet {
  margin: 0; font-size: 0.75rem; line-height: 1.5; color: var(--body);
  white-space: pre-wrap; word-break: break-word; overflow: visible;
}
.gh-card .block { margin: 0; min-width: 0; }
.gh-card .plain {
  margin: 0; font-size: 0.8125rem; line-height: 1.5; color: var(--body);
  white-space: pre-wrap; word-break: break-word;
}
.gh-card .subj {
  margin: 0 0 0.25rem; font-size: 0.8125rem; font-weight: 600; color: var(--title);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gh-card .meta {
  display: flex; flex-wrap: wrap; gap: 0.375rem 0.625rem;
  margin-top: 0.375rem; font-size: 0.6875rem; color: #8b949e;
}
.gh-card .acts { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.625rem; }
.gh-card .btn {
  border: none; border-radius: 0.375rem; padding: 0.375rem 0.625rem;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
}
.gh-card .btn.ghost { background: var(--bg); color: var(--title); }
.gh-card .btn.primary { background: #1f883d; color: #fff; }
.gh-card .btn:hover { filter: brightness(0.97); }
`;
function ensureStyles() {
    if (typeof document === 'undefined')
        return;
    let el = document.getElementById(STYLE_ID);
    if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    el.textContent = plugin.theme.css(CSS);
}
function trimLead(snippet, subjectTitle) {
    const lines = String(snippet || '').split('\n');
    if (!lines.length)
        return '';
    const first = lines[0].trim();
    const ver = String(subjectTitle || '').replace(/^v/i, '').trim();
    const dup = /^what'?s\s+new/i.test(first) ||
        /^更新/i.test(first) ||
        (ver && first.replace(/^v/i, '').includes(ver));
    if (dup) {
        let i = 1;
        while (i < lines.length && !lines[i].trim())
            i += 1;
        return lines.slice(i).join('\n');
    }
    return snippet;
}
function formatTime(iso) {
    if (!iso)
        return '';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime()))
            return '';
        return d.toLocaleString();
    }
    catch {
        return '';
    }
}
export default function GithubNotifyCard({ event: incomingEvent = {}, isHovered = false, onClose, onAction }) {
    useEffect(ensureStyles, []);
    const event = incomingEvent || {};
    const payload = event.payload || {};
    const actions = event.actions || [];
    const reason = payload.reason_label || payload.reason || '';
    const when = formatTime(payload.updated_at);
    const children = [
        h('div', {
            key: 'header',
            className: 'hdr'
        }, h('div', {
            className: 'left'
        }, h('span', {
            className: 'badge'
        }, 'GH'), h('h2', {
            className: 'title'
        }, event.title || 'GitHub')), h('button', {
            className: 'x',
            type: 'button',
            'aria-label': 'Close',
            onClick: () => onClose?.()
        }, '×')),
    ];
    if (!event.sticky) {
        children.push(h('div', {
            key: 'progress',
            className: ['bar', isHovered ? 'paused' : ''].filter(Boolean).join(" ")
        }));
    }
    const subjectTitle = payload.subject_title || '';
    const snippet = trimLead(payload.body_snippet || '', subjectTitle);
    const author = payload.body_author || '';
    if (subjectTitle || snippet || event.body) {
        if (payload.body_snippet) {
            children.push(h('div', {
                key: 'content',
                className: 'block'
            }, subjectTitle ? h('p', {
                className: 'subj'
            }, subjectTitle) : null, snippet ? h('p', {
                className: 'snippet'
            }, snippet) : null));
        }
        else {
            children.push(h('p', {
                key: 'content',
                className: 'plain'
            }, event.body || subjectTitle));
        }
    }
    if (author || reason || when) {
        children.push(h('div', {
            key: 'metadata',
            className: 'meta'
        }, author ? h('span', null, author) : null, reason ? h('span', null, reason) : null, when ? h('span', null, when) : null));
    }
    if (actions.length) {
        children.push(h('div', {
            key: 'actions',
            className: 'acts'
        }, actions.map((a, i) => h('button', {
            key: a.id,
            type: 'button',
            className: ['btn', a.id === 'open' || i === 0 ? 'primary' : 'ghost'].filter(Boolean).join(" "),
            onClick: () => onAction?.(a.id)
        }, a.label))));
    }
    return h('div', {
        className: 'gh-card'
    }, children);
}
