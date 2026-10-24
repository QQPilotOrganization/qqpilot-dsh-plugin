/* qqpilot-dsh-plugin — browser half (hand-written __ModuleLoader__ bundle, no build step).
 * Adds a 「QQPilot 接入」 section to DSH Settings: shows the OpenAI-compatible
 * endpoint URL for QQPilot, a compatibility-mode toggle, agent instructions,
 * runtime stats and a connection test. Routes are served by lib/index.js.
 */
window.__ModuleLoader__.load({
  id: 'qqpilot-dsh-plugin',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');

    var CSS = `.qqp-root{display:flex;flex-direction:column;gap:14px;padding:2px 2px 24px;color:var(--dsw-alias-label-primary,#1f2329);font-size:13px;line-height:1.55;}
.qqp-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.qqp-title{font-size:16px;font-weight:600;}
.qqp-spacer{flex:1;}
.qqp-pill{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,#e5e6eb);background:var(--dsw-alias-bg-layer-2,#f5f6f8);font-size:12px;color:var(--dsw-alias-label-secondary,#646a73);white-space:nowrap;}
.qqp-pill-dot{width:6px;height:6px;border-radius:50%;background:currentColor;}
.qqp-pill.ok{color:var(--dsw-alias-state-success-primary,#1f9e4f);}
.qqp-pill.err{color:var(--dsw-alias-state-error-primary,#e5484d);}
.qqp-pill.busy{color:var(--dsw-alias-state-warn-primary,#d97706);}
.qqp-desc{color:var(--dsw-alias-label-secondary,#646a73);font-size:12px;}
.qqp-card{display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsw-alias-border-l1,#e5e6eb);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f5f6f8);padding:12px 14px;}
.qqp-section-title{font-size:13px;font-weight:600;}
.qqp-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#646a73);}
.qqp-hint code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;padding:1px 4px;border-radius:4px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,#e5e6eb);word-break:break-all;}
.qqp-endpoint-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.qqp-code{flex:1 1 220px;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#e5e6eb);background:var(--dsw-alias-bg-layer-1,#fff);word-break:break-all;color:var(--dsw-alias-label-primary,#1f2329);}
.qqp-btn{flex:none;appearance:none;border:1px solid var(--dsw-alias-border-l1,#e5e6eb);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:12px;padding:6px 12px;cursor:pointer;transition:background .15s,border-color .15s,opacity .15s;}
.qqp-btn:hover{background:var(--dsw-alias-bg-layer-2,#f5f6f8);}
.qqp-btn:disabled{opacity:.55;cursor:default;}
.qqp-btn.primary{background:var(--dsw-alias-brand-primary,#12b7f5);border-color:transparent;color:#fff;font-weight:500;}
.qqp-btn.primary:hover{opacity:.9;background:var(--dsw-alias-brand-primary,#12b7f5);}
.qqp-row{display:flex;align-items:flex-start;gap:14px;}
.qqp-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}
.qqp-row-label{font-size:13px;font-weight:600;}
.qqp-switch{position:relative;flex:none;width:40px;height:22px;margin-top:2px;padding:0;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#c9cdd4);background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;transition:background .15s,border-color .15s;}
.qqp-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary,#12b7f5);border-color:transparent;}
.qqp-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary,#646a73);transition:transform .15s,background .15s;}
.qqp-switch[aria-checked="true"] .qqp-knob{transform:translateX(18px);background:#fff;}
.qqp-divider{height:1px;background:var(--dsw-alias-border-l1,#e5e6eb);margin:2px 0;}
.qqp-field{display:flex;flex-direction:column;gap:6px;}
.qqp-field-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2329);}
.qqp-textarea,.qqp-input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l1,#e5e6eb);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;padding:8px 10px;outline:none;}
.qqp-textarea{min-height:64px;resize:vertical;line-height:1.5;}
.qqp-textarea:focus,.qqp-input:focus{border-color:var(--dsw-alias-brand-primary,#12b7f5);}
.qqp-inline{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.qqp-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary,#646a73);}
.qqp-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;}
.qqp-stat{border:1px solid var(--dsw-alias-border-l1,#e5e6eb);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);padding:8px 10px;}
.qqp-stat-num{font-size:17px;font-weight:600;line-height:1.3;}
.qqp-stat-label{font-size:11px;color:var(--dsw-alias-label-secondary,#646a73);}
.qqp-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#e5484d);word-break:break-word;}
.qqp-notice{font-size:12px;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#e5e6eb);background:var(--dsw-alias-bg-layer-2,#f5f6f8);color:var(--dsw-alias-label-secondary,#646a73);}
.qqp-notice.ok{color:var(--dsw-alias-state-success-primary,#1f9e4f);}
.qqp-notice.err{color:var(--dsw-alias-state-error-primary,#e5484d);}
.qqp-test-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.qqp-test-row .qqp-input{flex:1 1 200px;width:auto;}
.qqp-test-result{display:flex;flex-direction:column;gap:6px;}
.qqp-tag{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:11px;border:1px solid var(--dsw-alias-border-l1,#e5e6eb);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);}
.qqp-reply{margin:0;max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:12px;line-height:1.55;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#e5e6eb);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);}
@media (max-width:520px){.qqp-stats{grid-template-columns:repeat(2,minmax(0,1fr));}}`;

    // ── helpers ──────────────────────────────────────────────────────────────
    function errText(err) {
      if (!err) return '未知错误';
      return String(err.message || err);
    }

    function request(method, path, body) {
      if (typeof fetch !== 'function') return Promise.reject(new Error('当前环境不支持 fetch'));
      var init = {
        method: method,
        cache: 'no-store',
        headers: body === undefined ? {} : { 'content-type': 'application/json' }
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      return fetch(path, init).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (e) {
              throw new Error('响应不是 JSON（HTTP ' + res.status + '）');
            }
          }
          if (!res.ok) {
            throw new Error((data && data.error) || ('HTTP ' + res.status));
          }
          return data;
        });
      });
    }

    function baseUrl(endpoint) {
      return String(endpoint || '')
        .replace(/\/+$/, '')
        .replace(/\/v1$/i, '');
    }

    function clip(text, max) {
      var s = String(text === null || text === undefined ? '' : text);
      if (s.length <= max) return s;
      return s.slice(0, max) + '…';
    }

    function statusClass(status) {
      if (status === 'ok') return 'ok';
      if (status === 'error') return 'err';
      return 'busy';
    }

    function statusLabel(status) {
      if (status === 'ok') return '已连接';
      if (status === 'error') return '失败';
      return '加载中';
    }

    // ── small presentational pieces ──────────────────────────────────────────
    function Btn(props) {
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'qqp-btn' + (props.primary ? ' primary' : ''),
          disabled: !!props.disabled,
          onClick: props.onClick
        },
        props.children
      );
    }

    function Stat(props) {
      var value = props.value === null || props.value === undefined ? '-' : String(props.value);
      return React.createElement(
        'div',
        { className: 'qqp-stat' },
        React.createElement('div', { className: 'qqp-stat-num' }, value),
        React.createElement('div', { className: 'qqp-stat-label' }, props.label)
      );
    }

    function Header(props) {
      return React.createElement(
        'div',
        { className: 'qqp-header' },
        React.createElement('div', { className: 'qqp-title' }, 'QQPilot 接入'),
        React.createElement(
          'span',
          { className: 'qqp-pill ' + statusClass(props.status) },
          React.createElement('span', { className: 'qqp-pill-dot' }),
          statusLabel(props.status)
        ),
        React.createElement('span', { className: 'qqp-spacer' }),
        React.createElement(
          Btn,
          { onClick: props.onRefresh, disabled: props.status === 'loading' },
          props.status === 'loading' ? '刷新中…' : '刷新'
        )
      );
    }

    // ── main settings card ───────────────────────────────────────────────────
    function SettingsCard() {
      var cs = React.useState(null);
      var config = cs[0];
      var setConfig = cs[1];
      var ss = React.useState('loading');
      var status = ss[0];
      var setStatus = ss[1];
      var es = React.useState(null);
      var error = es[0];
      var setError = es[1];
      var eps = React.useState('');
      var endpoint = eps[0];
      var setEndpoint = eps[1];
      var sts = React.useState(null);
      var stats = sts[0];
      var setStats = sts[1];
      var ds = React.useState('');
      var draft = ds[0];
      var setDraft = ds[1];
      var svs = React.useState('');
      var saved = svs[0];
      var setSaved = svs[1];
      var bss = React.useState(false);
      var saving = bss[0];
      var setSaving = bss[1];
      var ns = React.useState(null);
      var notice = ns[0];
      var setNotice = ns[1];
      var cps = React.useState(false);
      var copied = cps[0];
      var setCopied = cps[1];
      var tts = React.useState('在吗');
      var testText = tts[0];
      var setTestText = tts[1];
      var tbs = React.useState(false);
      var testing = tbs[0];
      var setTesting = tbs[1];
      var trs = React.useState(null);
      var testResult = trs[0];
      var setTestResult = trs[1];
      var tes = React.useState(null);
      var testError = tes[0];
      var setTestError = tes[1];

      function load() {
        setStatus('loading');
        setError(null);
        setCopied(false);
        request('GET', '/qqpilot/api/config')
          .then(function (data) {
            if (!data || data.ok !== true) {
              throw new Error((data && data.error) || '读取配置失败');
            }
            var cfg = data.config || {};
            setConfig(cfg);
            setEndpoint(data.endpoint || cfg.endpoint || '');
            setStats(data.stats || null);
            setDraft(cfg.extraInstructions || '');
            setSaved(cfg.extraInstructions || '');
            setStatus('ok');
          })
          .catch(function (err) {
            setStatus('error');
            setError(errText(err));
          });
      }

      React.useEffect(function () {
        load();
      }, []);

      function patchConfig(patch, okMessage) {
        var prev = config || {};
        var next = {};
        var key;
        for (key in prev) {
          if (Object.prototype.hasOwnProperty.call(prev, key)) next[key] = prev[key];
        }
        for (key in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
        }
        setConfig(next);
        setSaving(true);
        setNotice(null);
        return request('POST', '/qqpilot/api/config', patch)
          .then(function (data) {
            if (!data || data.ok !== true) {
              throw new Error((data && data.error) || '保存失败');
            }
            if (data.config) setConfig(data.config);
            if (okMessage) setNotice({ kind: 'ok', text: okMessage });
            setSaving(false);
            return true;
          })
          .catch(function (err) {
            setConfig(prev);
            setSaving(false);
            setNotice({ kind: 'err', text: '保存失败：' + errText(err) });
            return false;
          });
      }

      function toggleCompat() {
        if (!config || saving) return;
        patchConfig({ compatibilityMode: !config.compatibilityMode }, '兼容性模式已保存');
      }

      function saveInstructions() {
        if (saving) return;
        var text = draft || '';
        patchConfig({ extraInstructions: text }, '附加指令已保存').then(function (ok) {
          if (ok) setSaved(text);
        });
      }

      function copyEndpoint() {
        if (!endpoint) return;
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(endpoint).then(
              function () {
                setCopied(true);
              },
              function () {
                /* clipboard unavailable — ignore */
              }
            );
          }
        } catch (e) {
          /* ignore */
        }
      }

      function runTest() {
        if (testing) return;
        var text = String(testText || '').trim() || '在吗';
        setTesting(true);
        setTestResult(null);
        setTestError(null);
        request('POST', '/qqpilot/api/test', { text: text })
          .then(function (data) {
            setTesting(false);
            if (!data || data.ok !== true) {
              throw new Error((data && data.error) || '测试失败');
            }
            setTestResult(data);
          })
          .catch(function (err) {
            setTesting(false);
            setTestError(errText(err));
          });
      }

      function onTestKeyDown(e) {
        if (e && e.key === 'Enter') {
          e.preventDefault();
          runTest();
        }
      }

      if (!config) {
        return React.createElement(
          'div',
          { className: 'qqp-root' },
          React.createElement(Header, { status: status, onRefresh: load }),
          error
            ? React.createElement('div', { className: 'qqp-error' }, '加载配置失败：' + error)
            : React.createElement('div', { className: 'qqp-desc' }, '正在加载 QQPilot 接入配置…'),
          error
            ? React.createElement(Btn, { onClick: load }, '重新加载')
            : null
        );
      }

      var cfgProvider = config.provider || '未知';
      var cfgModel = config.model || '未知';
      var compat = !!config.compatibilityMode;
      var dirty = draft !== saved;
      var stat = stats || {};
      var replyInfo = (testResult && testResult.reply) || {};
      var imageCount = typeof replyInfo.images === 'number' ? replyInfo.images : 0;
      var replyText = clip(replyInfo.text || '', 300);

      return React.createElement(
        'div',
        { className: 'qqp-root' },
        React.createElement(Header, { status: status, onRefresh: load }),
        React.createElement(
          'div',
          { className: 'qqp-desc' },
          'QQPilot 通过 OpenAI Chat Completion 协议把 QQ 消息发给本机 DSH 模型；由模型决定是否回复、回复内容，并可附带图片。'
        ),
        notice ? React.createElement('div', { className: 'qqp-notice ' + (notice.kind || '') }, notice.text) : null,
        error ? React.createElement('div', { className: 'qqp-error' }, '刷新失败：' + error) : null,

        // endpoint
        React.createElement(
          'div',
          { className: 'qqp-card' },
          React.createElement('div', { className: 'qqp-section-title' }, '接口地址'),
          React.createElement(
            'div',
            { className: 'qqp-endpoint-row' },
            React.createElement('code', { className: 'qqp-code' }, endpoint || '（尚未获取到地址）'),
            React.createElement(Btn, { onClick: copyEndpoint, disabled: !endpoint }, copied ? '已复制' : '复制')
          ),
          React.createElement(
            'div',
            { className: 'qqp-hint' },
            '在 QQPilot 的 config.ini 里设置 ',
            React.createElement('code', null, 'server_url = ' + (endpoint ? baseUrl(endpoint) : '…')),
            '，api_key 留空即可（本机回环地址不会带鉴权头）。模型中请选择支持工具调用的模型。'
          )
        ),

        // compatibility + instructions + model
        React.createElement(
          'div',
          { className: 'qqp-card' },
          React.createElement(
            'div',
            { className: 'qqp-row' },
            React.createElement(
              'div',
              { className: 'qqp-row-main' },
              React.createElement('div', { className: 'qqp-row-label' }, '兼容性模式'),
              React.createElement(
                'div',
                { className: 'qqp-hint' },
                '开启后不向模型提供工具，直接把模型输出作为回复返回（适合不支持工具调用的模型/服务商）。关闭时模型通过 qqpilot_reply / qqpilot_do_not_reply 工具决定是否回复。'
              )
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                role: 'switch',
                'aria-checked': compat ? 'true' : 'false',
                'aria-label': '兼容性模式',
                className: 'qqp-switch',
                disabled: saving,
                onClick: toggleCompat
              },
              React.createElement('span', { className: 'qqp-knob' })
            )
          ),
          React.createElement('div', { className: 'qqp-divider' }),
          React.createElement(
            'div',
            { className: 'qqp-field' },
            React.createElement('div', { className: 'qqp-field-label' }, '附加指令（可选）'),
            React.createElement('textarea', {
              className: 'qqp-textarea',
              value: draft,
              rows: 3,
              placeholder: '例如：回复尽量简短，用中文，不要使用表情。',
              onChange: function (e) {
                setDraft(e.target.value);
              }
            }),
            React.createElement(
              'div',
              { className: 'qqp-inline' },
              React.createElement(Btn, { onClick: saveInstructions, disabled: !dirty || saving, primary: true }, saving ? '保存中…' : '保存'),
              dirty ? React.createElement('span', { className: 'qqp-hint' }, '有未保存的修改') : null
            )
          ),
          React.createElement(
            'div',
            { className: 'qqp-meta' },
            React.createElement('span', null, '模型：' + cfgProvider + '/' + cfgModel),
            typeof config.maxToolRounds === 'number'
              ? React.createElement('span', null, '工具轮数上限：' + config.maxToolRounds)
              : null
          )
        ),

        // stats
        React.createElement(
          'div',
          { className: 'qqp-card' },
          React.createElement('div', { className: 'qqp-section-title' }, '运行统计'),
          React.createElement(
            'div',
            { className: 'qqp-stats' },
            React.createElement(Stat, { label: '请求', value: stat.requests }),
            React.createElement(Stat, { label: '回复', value: stat.replies }),
            React.createElement(Stat, { label: '沉默', value: stat.silences }),
            React.createElement(Stat, { label: '错误', value: stat.errors })
          ),
          stat.lastError ? React.createElement('div', { className: 'qqp-error' }, '最近错误：' + clip(stat.lastError, 300)) : null,
          stat.lastRequestAt ? React.createElement('div', { className: 'qqp-hint' }, '最近请求：' + stat.lastRequestAt) : null
        ),

        // test
        React.createElement(
          'div',
          { className: 'qqp-card' },
          React.createElement('div', { className: 'qqp-section-title' }, '测试连接'),
          React.createElement(
            'div',
            { className: 'qqp-test-row' },
            React.createElement('input', {
              className: 'qqp-input',
              type: 'text',
              value: testText,
              placeholder: '在吗',
              onChange: function (e) {
                setTestText(e.target.value);
              },
              onKeyDown: onTestKeyDown
            }),
            React.createElement(Btn, { onClick: runTest, disabled: testing, primary: true }, testing ? '测试中…' : '测试连接')
          ),
          testError ? React.createElement('div', { className: 'qqp-error' }, '测试失败：' + testError) : null,
          testResult
            ? React.createElement(
                'div',
                { className: 'qqp-test-result' },
                React.createElement(
                  'div',
                  { className: 'qqp-meta' },
                  React.createElement('span', { className: 'qqp-tag' }, testResult.mode === 'compat' ? '兼容模式' : '工具模式'),
                  React.createElement('span', null, '用时 ' + (typeof testResult.elapsedMs === 'number' ? testResult.elapsedMs : '-') + ' ms'),
                  React.createElement('span', null, '图片 ' + imageCount + ' 张')
                ),
                React.createElement(
                  'pre',
                  { className: 'qqp-reply' },
                  replyText || (imageCount > 0 ? '（仅发送图片，无文字回复）' : '（模型本次选择沉默，未回复）')
                )
              )
            : null
        )
      );
    }

    var inject = ['slots'];

    function apply(ctx) {
      var style = document.createElement('style');
      style.setAttribute('data-plugin', 'qqpilot-dsh-plugin');
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);

      ctx.effect(function () {
        return function () {
          if (style.parentNode) style.parentNode.removeChild(style);
        };
      }, 'qqpilot-dsh-plugin: styles');

      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'qqpilot',
            order: 62,
            label: function () {
              return 'QQPilot 接入';
            }
          },
          SettingsCard
        );
      });
    }

    exports.inject = inject;
    exports.apply = apply;
    exports.name = 'qqpilot-dsh-plugin';
    return module.exports;
  }
});
