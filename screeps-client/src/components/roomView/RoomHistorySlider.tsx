import { createEffect, createSignal, onCleanup } from 'solid-js'
import { historyLoading, historyMaxTick, historyMinTick, historyTick, seekToTick } from '~/stores/historyStore.js'

/** Bottom timeline bar for history mode; seeks are debounced while dragging. */
export function RoomHistorySlider() {
  const [sliderValue, setSliderValue] = createSignal(historyTick())
  createEffect(() => setSliderValue(historyTick()))

  let seekDebounceTimer: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    if (seekDebounceTimer !== null) clearTimeout(seekDebounceTimer)
  })

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '8px 12px',
        background: 'rgba(13, 17, 23, 0.85)',
        'border-top': '1px solid #30363d',
        'z-index': 10,
      }}
    >
      <input
        type="range"
        min={historyMinTick()}
        max={historyMaxTick()}
        value={sliderValue()}
        step={1}
        onInput={(e) => {
          const v = parseInt(e.currentTarget.value, 10)
          setSliderValue(v)
          if (seekDebounceTimer !== null) clearTimeout(seekDebounceTimer)
          seekDebounceTimer = setTimeout(() => {
            seekDebounceTimer = null
            seekToTick(v)
          }, 150)
        }}
        style={{ width: '100%', cursor: 'pointer' }}
      />
      <div
        style={{
          display: 'flex',
          'justify-content': 'space-between',
          'font-size': '10px',
          color: '#8b949e',
          'margin-top': '2px',
        }}
      >
        <span>{historyMinTick()}</span>
        <span style={{ color: historyLoading() ? '#f0883e' : '#8b949e' }}>
          {historyLoading() ? 'Loading…' : `Tick ${historyTick()}`}
        </span>
        <span>{historyMaxTick()}</span>
      </div>
    </div>
  )
}
