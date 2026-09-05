import { Wordmark } from '@shared/Wordmark'
import { COLOR, FONT } from '@shared/tokens'

// Placeholder -- proves the @shared alias pipeline (shared/ -> both Vite
// projects) works end-to-end. The real landing page (all sections, real
// copy, real covers) is a separate, later pass -- see the redesign plan.
export default function App() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: COLOR.bgHex,
        color: '#fff',
        fontFamily: FONT.display,
      }}
    >
      <Wordmark size={40} />
    </div>
  )
}