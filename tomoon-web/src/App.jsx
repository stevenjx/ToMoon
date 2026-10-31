import { useCallback, useEffect, useState } from 'react'
import './App.css'
import axios from 'axios'

// 生产环境下由后端 actix 直接托管，同源即可；开发时连本地后端
const BASE = import.meta.env.DEV ? 'http://127.0.0.1:55556' : ''
const FORM = { headers: { 'content-type': 'application/x-www-form-urlencoded' } }

function App() {
  const [status, setStatus] = useState({ enabled: false, running: false })
  const [subs, setSubs] = useState([])
  const [current, setCurrent] = useState('')
  const [link, setLink] = useState('')
  const [subconv, setSubconv] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tip, setTip] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        axios.get(`${BASE}/clash_status`),
        axios.get(`${BASE}/sub_list`),
      ])
      setStatus({ enabled: !!s.data.enabled, running: !!s.data.running })
      setSubs(l.data.subs || [])
      setCurrent(l.data.current_sub || '')
    } catch (e) {
      // 后端还没起来时静默重试
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [refresh])

  const toggle = async () => {
    setBusy(true)
    setTip(status.enabled ? '正在停止…' : '正在启动…')
    try {
      const r = await axios.post(
        `${BASE}/set_clash_status`,
        new URLSearchParams({ enabled: String(!status.enabled) }),
        FORM
      )
      setTip(r.data.status_code === 200 ? '' : '操作失败，请查看 /tmp/tomoon.log')
      await refresh()
    } catch (e) {
      setTip('操作失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const selectSub = async (path) => {
    await axios.post(`${BASE}/set_sub`, new URLSearchParams({ path }), FORM)
    setCurrent(path)
  }

  const addSub = async () => {
    const value = link.trim()
    if (!value) return
    setBusy(true)
    setTip('正在添加订阅…')
    try {
      await axios.post(
        `${BASE}/download_sub`,
        new URLSearchParams({ link: value, subconv: String(subconv) }),
        FORM
      )
      setLink('')
      const l = await axios.get(`${BASE}/sub_list`)
      const list = l.data.subs || []
      setSubs(list)
      const last = list[list.length - 1]
      if (last) {
        await selectSub(last.path)
        setTip('已添加并切换到该订阅')
      } else {
        setTip('已添加')
      }
    } catch (e) {
      const detail = e?.response?.data || e.message
      setTip('添加失败：' + detail)
    } finally {
      setBusy(false)
    }
  }

  const resetNetwork = async () => {
    setTip('正在复原网络…')
    try {
      const r = await axios.post(`${BASE}/reset_network`, new URLSearchParams(), FORM)
      setTip(r.data.message || '完成')
    } catch (e) {
      setTip('复原失败：' + e.message)
    }
  }

  return (
    <div style={{ background: '#FAFFE3', minHeight: '100vh' }} className="flex justify-center py-10 px-4">
      <div className="w-full max-w-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h1 className="text-5xl tomoon-title">ToMoon</h1>
          <span
            className="px-4 py-1 rounded-full text-sm"
            style={{
              background: status.running ? '#5A6242' : '#C9CDBB',
              color: status.running ? '#FFFFFF' : '#474743',
            }}
          >
            {status.running ? '运行中' : '已停止'}
          </span>
        </div>

        <section className="rounded-2xl p-5 flex items-center justify-between" style={{ background: '#FFFFFF' }}>
          <div>
            <div className="text-xl tomoon-title">代理开关</div>
            <div className="text-sm text-gray-500">
              {status.enabled ? 'TUN 已接管系统流量' : '当前未启用'}
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={status.enabled} disabled={busy} onChange={toggle} />
            <span className="slider round"></span>
          </label>
        </section>

        <section className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: '#FFFFFF' }}>
          <div className="text-xl tomoon-title">订阅</div>
          {subs.length === 0 && (
            <div className="text-sm text-gray-500">还没有订阅，在下面添加一个。</div>
          )}
          {subs.map((s) => {
            const active = s.path === current
            return (
              <button
                key={s.path}
                onClick={() => selectSub(s.path)}
                className="text-left rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                style={{ background: active ? '#DEE7BF' : '#F4F6EC' }}
              >
                <span className="truncate">
                  <span className="block text-base" style={{ color: '#474743' }}>
                    {s.name}
                  </span>
                  <span className="block text-xs text-gray-500 truncate">{s.url}</span>
                </span>
                <span className="text-sm shrink-0" style={{ color: '#5A6242' }}>
                  {active ? '使用中' : '切换'}
                </span>
              </button>
            )
          })}

          <div className="flex gap-2 mt-1">
            <input
              className="tomoon-input grow pl-4 text-base"
              placeholder="Clash 订阅链接，或直接粘贴 ss:// 链接"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addSub()
              }}
            />
            <button className="tomoon-button" disabled={busy} onClick={addSub}>
              添加
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={subconv} onChange={(e) => setSubconv(e.target.checked)} />
            用 subconverter 转换（v2ray / ss 等非 Clash 订阅）
          </label>
        </section>

        <section className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: '#FFFFFF' }}>
          <div className="text-xl tomoon-title">故障恢复</div>
          <div className="text-sm text-gray-500">
            如果关闭代理后仍然无法上网，点这里复原 DNS 与网卡配置。
          </div>
          <button
            onClick={resetNetwork}
            className="rounded-xl px-4 py-3 text-left"
            style={{ background: '#F4F6EC', color: '#474743' }}
          >
            复原网络
          </button>
        </section>

        {tip && (
          <div className="text-sm px-1" style={{ color: '#5A6242' }}>
            {tip}
          </div>
        )}

        <div className="text-xs text-gray-400 px-1">
          桌面模式用浏览器打开 http://127.0.0.1:55556 即可控制；游戏模式请用 Decky 面板。
        </div>
      </div>
    </div>
  )
}

export default App
