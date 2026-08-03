import { Show, type JSX } from 'solid-js'
import { gameTime, worldStatus } from '~/stores/clientStore.js'
import { historyMode } from '~/stores/historyStore.js'
import { decorateHint } from '~/stores/decorationEditStore.js'
import { AMBER } from '~/components/theme.js'

/** Decorate mode's hint, which depends on the draft rather than the mode alone. */
export function DecorateHint() {
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px', 'text-align': 'center' }}>
      <span>{decorateHint().primary}</span>
      <Show when={decorateHint().note}>
        {(note) => <span style={{ color: AMBER }}>{note()}</span>}
      </Show>
      <span style={{ opacity: '0.6', 'font-size': '0.9em' }}>{decorateHint().secondary}</span>
    </div>
  )
}

/** Top-center pill showing the current interaction mode's hint. */
export function ModeHintPill(props: { hint: JSX.Element }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '6px 16px',
        'border-radius': '6px',
        background: 'rgba(13, 17, 23, 0.65)',
        border: '1px solid rgba(48, 54, 61, 0.6)',
        'font-size': '13px',
        'font-weight': 500,
        color: '#c9d1d9',
        'pointer-events': (worldStatus() === 'empty' || worldStatus() === 'lost') ? 'auto' : 'none',
        'user-select': 'none',
        'z-index': 10,
      }}
    >
      {props.hint}
    </div>
  )
}

/** Top-right "Tick N" badge, hidden in history mode (the slider shows the tick there). */
export function TickBadge() {
  return (
    <Show when={!historyMode() && gameTime() !== null}>
      <div
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          padding: '4px 10px',
          'border-radius': '4px',
          background: 'rgba(13, 17, 23, 0.8)',
          border: '1px solid #30363d',
          'font-size': '12px',
          color: '#8b949e',
          'z-index': 10,
        }}
      >
        Tick {gameTime()}
      </div>
    </Show>
  )
}

/** Centered card shown when the requested history tick has no data on the server. */
export function HistoryNoDataCard() {
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        padding: '16px 22px',
        'border-radius': '8px',
        background: 'rgba(13, 17, 23, 0.9)',
        border: '1px solid #30363d',
        'text-align': 'center',
        'max-width': '320px',
        'pointer-events': 'none',
        'user-select': 'none',
        'z-index': 11,
      }}
    >
      <div style={{ 'font-size': '14px', 'font-weight': 600, color: '#c9d1d9', 'margin-bottom': '4px' }}>
        No data available for this tick
      </div>
      <div style={{ 'font-size': '12px', color: '#8b949e' }}>
        Use the timeline below to choose another tick.
      </div>
    </div>
  )
}
