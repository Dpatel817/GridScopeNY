import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Prices from './pages/Prices'
import Demand from './pages/Demand'
import Generation from './pages/Generation'
import InterfaceFlows from './pages/InterfaceFlows'
import Congestion from './pages/Congestion'
import GeneratorMap from './pages/GeneratorMap'
import OpportunityExplorer from './pages/OpportunityExplorer'
import AIExplainer from './pages/AIExplainer'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="prices" element={<Prices />} />
          <Route path="demand" element={<Demand />} />
          <Route path="generation" element={<Generation />} />
          <Route path="interfaces" element={<InterfaceFlows />} />
          <Route path="congestion" element={<Congestion />} />
          <Route path="generator-map" element={<GeneratorMap />} />
          <Route path="opportunities" element={<OpportunityExplorer />} />
          <Route path="ai-explainer" element={<AIExplainer />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
