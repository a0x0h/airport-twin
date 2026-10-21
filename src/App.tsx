import { useEffect, useState } from 'react'
import { useShiftScrollScrub } from './ui/Timeline'
import { Diorama } from './scene/Diorama'
import { Hall } from './scene/Hall'
import type { Route } from './ui/common'
import { HallOverlay } from './ui/HallOverlay'
import { Overlay } from './ui/Overlay'

const readRoute = (): Route => (location.hash === '#/kit' ? 'kit' : 'hall')

export function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  useShiftScrollScrub(route === 'hall' ? stage : null)
  useEffect(() => {
    const on = () => setRoute(readRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  return (
    <>
      <div className="stage" ref={setStage}>{route === 'hall' ? <Hall /> : <Diorama />}</div>
      {route === 'hall' ? <HallOverlay /> : <Overlay />}
    </>
  )
}
