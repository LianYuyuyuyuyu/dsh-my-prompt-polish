/**
 * dsh-my-prompt-polish — 浏览器半边。
 *
 * 1) 输入框左侧那排小按钮里加一个「优化」小图标：
 *      点一下 → 当前草稿改写成更清楚的提示词（记住原文）
 *      再点一下 → 原文放回去
 * 2) 设置 → 「提示词优化」页：编辑基准提示词、选通道与模型。
 *
 * 只走官方通道：useInput 读草稿，inputActions.setDraft 整段替换；
 * 不直接改页面里的编辑器节点（那是 Lexical 管的，硬改会被覆盖）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-prompt-polish',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/prompt-polish-9f2c'

    // ── 图标（统一 14px，跟随主题文字色）────────────────────────────
    function svg(props, children) {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
          ...props,
        },
        children,
      )
    }

    const SparkIcon = () =>
      svg(null, [
        h('path', {
          key: 'star',
          d: 'M8 1.8 9.5 6.5 14.2 8 9.5 9.5 8 14.2 6.5 9.5 1.8 8 6.5 6.5Z',
          fill: 'currentColor',
          stroke: 'none',
        }),
        h('path', { key: 'spark', d: 'M12.6 2.2v2.2M11.5 3.3h2.2' }),
      ])

    const UndoIcon = () =>
      svg(null, [
        h('path', { key: 'arc', d: 'M3.4 8a4.6 4.6 0 1 0 1.5-3.4' }),
        h('path', { key: 'head', d: 'M2.8 2.2v3.2h3.2' }),
      ])

    const BusyIcon = () =>
      svg(null, [
        h('circle', {
          key: 'c',
          cx: 8,
          cy: 8,
          r: 5.2,
          strokeOpacity: 0.25,
        }),
        h(
          'path',
          { key: 'd', d: 'M8 2.8a5.2 5.2 0 0 1 5.2 5.2' },
          h('animateTransform', {
            key: 'anim',
            attributeName: 'transform',
            type: 'rotate',
            from: '0 8 8',
            to: '360 8 8',
            dur: '0.9s',
            repeatCount: 'indefinite',
          }),
        ),
      ])

    const CheckIcon = () => svg(null, [h('path', { key: 'p', d: 'M3 8.4l3.2 3.2L13 5' })])
    const AlertIcon = () =>
      svg(null, [
        h('path', { key: 'a', d: 'M8 2.6 14.2 13.4H1.8Z' }),
        h('path', { key: 'b', d: 'M8 6.6v3.2M8 11.6v.1' }),
      ])

    // ── 输入框左侧的按钮 ──────────────────────────────────────────
    const btnBase = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '24px',
      height: '24px',
      padding: 0,
      borderRadius: '6px',
      border: '1px solid transparent',
      background: 'transparent',
      color: 'inherit',
      opacity: 0.85,
      cursor: 'pointer',
      flex: '0 0 auto',
    }

    function PolishButton(props) {
      const useInput = props.useInput
      const inputActions = props.inputActions

      const draft = useInput((s) => s.draft)
      const phase = useInput((s) => s.phase)
      const occurrences = useInput((s) => s.occurrences)

      const [busy, setBusy] = React.useState(false)
      const [stash, setStash] = React.useState(null)
      const [flash, setFlash] = React.useState(null)

      const live = React.useRef({ draft, phase, occurrences, stash, busy })
      live.current = { draft, phase, occurrences, stash, busy }

      React.useEffect(() => {
        if (!flash) return undefined
        const timer = window.setTimeout(() => setFlash(null), 3600)
        return () => window.clearTimeout(timer)
      }, [flash])

      const fail = (message) => {
        console.warn('[prompt-polish] ' + message)
        setFlash({ kind: 'err', text: message })
      }

      const onClick = async () => {
        const now = live.current
        if (now.busy) return
        if (now.phase !== 'plain') {
          fail('正在发送，稍等')
          return
        }

        if (now.stash && now.draft === now.stash.optimized) {
          inputActions.setDraft(now.stash.original)
          setStash(null)
          setFlash({ kind: 'ok', text: '已还原原文' })
          return
        }
        if (now.stash) setStash(null)

        const text = now.draft
        if (text.trim() === '') {
          fail('先写点内容再优化')
          return
        }
        if (now.occurrences && now.occurrences.length > 0) {
          fail('草稿里有 @ 引用，先清掉再优化')
          return
        }

        setBusy(true)
        setFlash(null)
        try {
          const response = await fetch(API + '/optimize', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          })
          const data = await response.json().catch(() => null)
          if (!response.ok || !data || data.ok !== true) {
            fail((data && data.message) || '优化失败，可再试一次')
            return
          }
          const optimized = String(data.text || '').trim()
          if (optimized === '') {
            fail('模型没返回内容，可再试')
            return
          }
          if (live.current.draft !== text) {
            fail('内容刚变了，没有替换')
            return
          }
          setStash({ original: text, optimized })
          inputActions.setDraft(optimized)
          setFlash({ kind: 'ok', text: '已优化，再点图标还原' })
        } catch (error) {
          fail('网络失败，可再试一次')
        } finally {
          setBusy(false)
        }
      }

      let icon = h(SparkIcon)
      let title = '用基准提示词优化当前输入（设置 → 提示词优化 可改规则）'
      let style = btnBase
      if (busy) {
        icon = h(BusyIcon)
        title = '正在优化…'
        style = { ...btnBase, opacity: 0.55, cursor: 'default' }
      } else if (flash && flash.kind === 'err') {
        icon = h(AlertIcon)
        title = flash.text
        style = { ...btnBase, color: errColor, borderColor: 'var(--dsw-alias-state-error-primary, rgba(224,108,96,.5))' }
      } else if (flash && flash.kind === 'ok') {
        icon = h(CheckIcon)
        title = flash.text
        style = { ...btnBase, color: okColor }
      } else if (stash) {
        icon = h(UndoIcon)
        title = '点一下：还原到你原来的输入'
        style = {
          ...btnBase,
          borderColor: 'var(--dsw-alias-border-l2, rgba(127,127,127,.45))',
          background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12))',
        }
      }

      return h(
        'button',
        {
          type: 'button',
          title,
          'aria-label': title,
          disabled: busy,
          onClick,
          style,
        },
        icon,
      )
    }

    // ── 设置页 ────────────────────────────────────────────────────
    const fieldLabel = { display: 'block', fontSize: '12px', opacity: 0.7, marginBottom: '6px' }
    const control = {
      width: '100%',
      boxSizing: 'border-box',
      background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14))',
      color: 'var(--dsw-alias-label-primary, inherit)',
      border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.4))',
      borderRadius: '6px',
      padding: '6px 8px',
      font: 'inherit',
      fontSize: '13px',
    }
    // 原生下拉的弹层不吃父级颜色，选项要自己上色，否则深色主题下白底浅字看不见
    const optionStyle = {
      background: 'var(--dsw-alias-bg-overlay, #2b2b2b)',
      color: 'var(--dsw-alias-label-primary, #e6e6e6)',
    }
    const primaryBtn = {
      padding: '6px 14px',
      borderRadius: '6px',
      border: '1px solid transparent',
      background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.22))',
      color: 'var(--dsw-alias-label-primary, inherit)',
      font: 'inherit',
      fontSize: '13px',
      cursor: 'pointer',
    }
    const ghostBtn = {
      ...primaryBtn,
      background: 'transparent',
      border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.4))',
    }
    const okColor = 'var(--dsw-alias-state-success-primary, #3f9d6a)'
    const errColor = 'var(--dsw-alias-state-error-primary, #e06c60)'

    function SettingsSection() {
      const [loading, setLoading] = React.useState(true)
      const [rule, setRule] = React.useState('')
      const [defaultRule, setDefaultRule] = React.useState('')
      const [providers, setProviders] = React.useState([])
      const [provider, setProvider] = React.useState('')
      const [model, setModel] = React.useState('')
      const [models, setModels] = React.useState([])
      const [sessionModel, setSessionModel] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [saving, setSaving] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        fetch(API + '/config')
          .then((r) => r.json())
          .then((data) => {
            if (!alive || !data || data.ok !== true) {
              if (alive) setStatus({ kind: 'err', text: '读取配置失败' })
              return
            }
            setRule(String(data.rule || ''))
            setDefaultRule(String(data.defaultRule || ''))
            setProviders(Array.isArray(data.providers) ? data.providers : [])
            setProvider(String(data.provider || ''))
            setModel(String(data.model || ''))
            setSessionModel(data.sessionModel || null)
          })
          .catch(() => {
            if (alive) setStatus({ kind: 'err', text: '读取配置失败（后台没响应）' })
          })
          .finally(() => {
            if (alive) setLoading(false)
          })
        return () => {
          alive = false
        }
      }, [])

      React.useEffect(() => {
        if (provider === '') {
          setModels([])
          return undefined
        }
        let alive = true
        fetch(API + '/models?provider=' + encodeURIComponent(provider))
          .then((r) => r.json())
          .then((data) => {
            if (!alive) return
            if (data && data.ok === true) setModels(Array.isArray(data.models) ? data.models : [])
            else setStatus({ kind: 'err', text: (data && data.message) || '取模型列表失败' })
          })
          .catch(() => {
            if (alive) setStatus({ kind: 'err', text: '取模型列表失败' })
          })
        return () => {
          alive = false
        }
      }, [provider])

      const save = async () => {
        setSaving(true)
        setStatus(null)
        try {
          const response = await fetch(API + '/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rule, provider, model: provider === '' ? '' : model }),
          })
          const data = await response.json().catch(() => null)
          if (!response.ok || !data || data.ok !== true) {
            setStatus({ kind: 'err', text: (data && data.message) || '保存失败' })
          } else {
            setStatus({ kind: 'ok', text: '已保存，下一次点优化就用新规则' })
          }
        } catch (error) {
          setStatus({ kind: 'err', text: '保存失败（网络）' })
        } finally {
          setSaving(false)
        }
      }

      if (loading) return h('div', { style: { fontSize: '13px', opacity: 0.7 } }, '读取中…')

      const sessionText = sessionModel
        ? `${sessionModel.provider} / ${sessionModel.model}`
        : '（当前没有选中的模型）'

      return h(
        'div',
        { style: { maxWidth: '760px', fontSize: '13px', lineHeight: 1.7 } },
        h('h3', { style: { margin: '0 0 6px', fontSize: '14px' } }, '提示词优化'),
        h(
          'p',
          { style: { margin: '0 0 16px', opacity: 0.65, fontSize: '12px' } },
          '输入框左边那个小图标用的就是这里的规则。不需要在这里填 API Key —— 直接用「设置 → 模型」里已经配好的通道，密钥只存一份。',
        ),

        h('div', { style: { marginBottom: '16px' } },
          h('label', { style: fieldLabel }, '用哪个模型改写'),
          h('div', { style: { display: 'flex', gap: '8px' } },
            h('select', {
              value: provider,
              onChange: (e) => {
                setProvider(e.target.value)
                setModel('')
              },
              style: { ...control, flex: '0 0 40%' },
            },
              h('option', { value: '', style: optionStyle }, '跟随当前会话模型'),
              ...providers.map((p) => h('option', { key: p.id, value: p.id, style: optionStyle }, p.name || p.id)),
            ),
            h('select', {
              value: model,
              disabled: provider === '',
              onChange: (e) => setModel(e.target.value),
              style: { ...control, flex: '1 1 auto', opacity: provider === '' ? 0.5 : 1 },
            },
              h('option', { value: '', style: optionStyle }, models.length === 0 ? '（先选通道）' : '选一个模型'),
              ...models.map((m) => h('option', { key: m.id, value: m.id, style: optionStyle }, m.name || m.id)),
            ),
          ),
          h('div', { style: { fontSize: '12px', opacity: 0.55, marginTop: '6px' } }, '当前会话模型：' + sessionText),
        ),

        h('div', { style: { marginBottom: '8px' } },
          h('label', { style: fieldLabel }, '基准提示词（点优化时套在你说的话前面）'),
          h('textarea', {
            value: rule,
            onChange: (e) => setRule(e.target.value),
            spellCheck: false,
            rows: 12,
            style: { ...control, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: '12px', lineHeight: '1.6' },
          }),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' } },
          h('button', { type: 'button', onClick: save, disabled: saving, style: primaryBtn }, saving ? '保存中…' : '保存'),
          h('button', {
            type: 'button',
            onClick: () => setRule(defaultRule),
            style: ghostBtn,
          }, '恢复默认规则'),
          status
            ? h('span', { style: { fontSize: '12px', color: status.kind === 'err' ? errColor : okColor } }, status.text)
            : null,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(
          () =>
            ctx.slots.inject('conversation.input.left', () =>
              ctx.slots.register(
                { name: 'conversation.input.left', id: 'prompt-polish-button', order: 10 },
                PolishButton,
              ),
            ),
          'prompt-polish: composer button',
        )
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                { name: 'settings.section', id: 'prompt-polish', order: 55, label: () => '提示词优化' },
                SettingsSection,
              ),
            ),
          'prompt-polish: settings section',
        )
      },
    }
  },
})
