import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/Layout';
import Bridge from './pages/Bridge';
import Fleet from './pages/Fleet';
import Logbook from './pages/Logbook';
import Watchtower from './pages/Watchtower';
import Admin from './pages/Admin';
import Brain from './pages/Brain';
import Archive from './pages/Archive';
import { db } from './lib/db';
import { AuthWrapper } from './components/AuthWrapper';

export default function App() {
  useEffect(() => {
    const checkOngoingTasks = async () => {
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const logs = await db.getLogs();
          const ongoing = logs.filter(l => l.status === 'Ongoing');
          if (ongoing.length > 0) {
            new Notification('Pulse Watchtower', {
              body: `You have ${ongoing.length} ongoing monitoring tasks.`,
              icon: '/favicon.ico'
            });
          }
        } catch (e) {
          // Ignore if not authenticated yet
        }
      } else if ('Notification' in window && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    };

    // Check on load and then every hour
    checkOngoingTasks();
    const interval = setInterval(checkOngoingTasks, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <AuthWrapper>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Bridge />} />
            <Route path="fleet" element={<Fleet />} />
            <Route path="logbook/:dspId" element={<Logbook />} />
            <Route path="brain" element={<Brain />} />
            <Route path="watchtower" element={<Watchtower />} />
            <Route path="archive" element={<Archive />} />
            <Route path="admin" element={<Admin />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthWrapper>
  );
}
