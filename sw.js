// Task Tracker — Service Worker
// Handles background deadline notifications

const CACHE = 'tracker-sw-v1';
const TASKS_URL = '/task-tracker/sw-tasks';

// Install & activate immediately
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ── Receive tasks from main app ──
self.addEventListener('message', async e => {
  if(e.data?.type !== 'STORE_TASKS') return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(TASKS_URL, new Response(JSON.stringify({
      tasks: e.data.tasks,
      settings: e.data.settings,
      savedAt: Date.now()
    }), {headers:{'Content-Type':'application/json'}}));
  } catch(err) {}
});

// ── Periodic Background Sync (Chrome Android, installed PWA) ──
self.addEventListener('periodicsync', e => {
  if(e.tag === 'check-deadlines') e.waitUntil(checkDeadlines());
});

// ── Also check on SW fetch (fallback for non-periodic browsers) ──
self.addEventListener('fetch', () => {});

async function checkDeadlines(){
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(TASKS_URL);
    if(!res) return;

    const {tasks, settings} = await res.json();
    if(!settings?.enabled) return;

    // Get PHT time
    const now = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Manila'}));

    for(const task of (tasks||[])){
      if(task.done || !task.deadline) continue;

      const [yy,mm,dd] = task.deadline.split('-').map(Number);
      const [hh,min] = (task.deadlineTime||'23:59').split(':').map(Number);
      const deadline = new Date(yy, mm-1, dd, hh, min, 0);
      const diffMins = (deadline - now) / 60000;

      const name = `"${task.name}"`;
      const proj = task.projectName || '';

      // Overdue (within 2hrs)
      if(diffMins < 0 && diffMins > -120){
        await notify(`⚠️ Overdue na! — ${name}`, proj, `ov-${task.id}`);
      }
      // 30 min window
      else if(settings.times?.includes(30) && diffMins >= 25 && diffMins <= 35){
        await notify(`🔴 30 minutos na lang! — ${name}`, proj, `30m-${task.id}`);
      }
      // 3 hour window
      else if(settings.times?.includes(180) && diffMins >= 170 && diffMins <= 195){
        await notify(`🟡 3 oras na lang! — ${name}`, proj, `3h-${task.id}`);
      }
      // Morning of deadline (7:55am - 8:05am)
      else if(settings.morning && now.getHours()===8 && now.getMinutes()<10 &&
              deadline.getDate()===now.getDate() && deadline.getMonth()===now.getMonth()){
        await notify(`🌅 Deadline ngayong araw! — ${name}`, proj, `mrn-${task.id}`);
      }
      // 1 day before at 9am
      else if(settings.times?.includes(1440)){
        const dayBefore = new Date(yy, mm-1, dd-1, 9, 0, 0);
        const sinceDayBefore = (now - dayBefore) / 60000;
        if(sinceDayBefore >= 0 && sinceDayBefore < 15){
          await notify(`📅 Bukas na ang deadline! — ${name}`, proj, `1d-${task.id}`);
        }
      }
    }
  } catch(err) {}
}

async function notify(title, body, tag){
  // Avoid duplicate notifications
  const existing = await self.registration.getNotifications({tag});
  if(existing.length > 0) return;

  await self.registration.showNotification(title, {
    body,
    tag,
    icon: 'https://navybye15.github.io/task-tracker/icon-192.png',
    badge: 'https://navybye15.github.io/task-tracker/icon-192.png',
    requireInteraction: false,
    vibrate: [200, 100, 200]
  });
}

// ── Open app on notification tap ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
      for(const c of list) if('focus' in c) return c.focus();
      return clients.openWindow(self.registration.scope);
    })
  );
});
