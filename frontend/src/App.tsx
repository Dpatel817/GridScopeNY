import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

const Layout = lazy(() => import('./components/Layout'))
const Home = lazy(() => import('./pages/Home'))
const Prices = lazy(() => import('./pages/Prices'))
const Demand = lazy(() => import('./pages/Demand'))
const Generation = lazy(() => import('./pages/Generation'))
const InterfaceFlows = lazy(() => import('./pages/InterfaceFlows'))
const Congestion = lazy(() => import('./pages/Congestion'))
const OpportunityExplorer = lazy(() => import('./pages/OpportunityExplorer'))
const InterconnectionQueue = lazy(() => import('./pages/InterconnectionQueue'))

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0d1117', color: '#e6edf3' }}>
          <div>Loading...</div>
        </div>
      }>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="prices" element={<Prices />} />
            <Route path="demand" element={<Demand />} />
            <Route path="generation" element={<Generation />} />
            <Route path="interfaces" element={<InterfaceFlows />} />
            <Route path="congestion" element={<Congestion />} />
            <Route path="interconnection-queue" element={<InterconnectionQueue />} />
            <Route path="opportunities" element={<OpportunityExplorer />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App

