import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard    from './pages/Dashboard'
import Passengers   from './pages/Passengers'
import Agencies     from './pages/Agencies'
import Trips        from './pages/Trips'
import Meetings     from './pages/Meetings'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index               element={<Dashboard  />} />
          <Route path="passageiros"  element={<Passengers />} />
          <Route path="agencias"     element={<Agencies   />} />
          <Route path="viagens"      element={<Trips      />} />
          <Route path="reunioes"     element={<Meetings   />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
