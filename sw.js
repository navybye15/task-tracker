// Navi Tracker — Service Worker v3
// Aggressive repeating reminders until task is done

const CACHE = 'navitracker-sw-v3';
const TASKS_URL = '/task-tracker/sw-tasks';

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

// ── Periodic Background Sync ──
self.addEventListener('periodicsync', e => {
  if(e.tag === 'check-deadlines') e.waitUntil(checkDeadlines());
});

self.addEventListener('fetch', () => {});

// ── Helper: get current hour-slot and 2hr-slot tags for repeating notifs ──
// Tags include a time-slot so each interval fires a fresh notification
function hourSlot(now) {
  // Changes every 60 minutes — used for "every 1 hour" reminders
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
}
function twoHourSlot(now) {
  // Changes every 2 hours — used for overdue reminders
  const slot = Math.floor(now.getHours() / 2);
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-2h${slot}`;
}

async function checkDeadlines(){
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(TASKS_URL);
    if(!res) return;

    const {tasks, settings} = await res.json();
    if(!settings?.enabled) return;

    // PHT time
    const now = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Manila'}));

    for(const task of (tasks||[])){
      if(task.done || !task.deadline) continue;

      const [yy,mm,dd] = task.deadline.split('-').map(Number);
      const [hh,min] = (task.deadlineTime||'23:59').split(':').map(Number);
      const deadline = new Date(yy, mm-1, dd, hh, min, 0);
      const diffMins = (deadline - now) / 60000;

      const name = `"${task.name}"`;
      const proj = task.projectName ? ` — ${task.projectName}` : '';

      // ── OVERDUE: every 2 hours hanggang ma-check ──
      if(diffMins < 0){
        const tag = `ov-${task.id}-${twoHourSlot(now)}`;
        const minsOverdue = Math.abs(Math.round(diffMins));
        const overdueTxt = minsOverdue < 60
          ? `${minsOverdue} minuto na ang nakalipas!`
          : `${Math.round(minsOverdue/60)} oras na ang nakalipas!`;
        await notify(
          `⚠️ OVERDUE! ${name}`,
          `${overdueTxt}${proj} — Hindi pa tapos!`,
          tag
        );
        continue;
      }

      // ── 10 MINUTES OR LESS: last warning ──
      if(diffMins <= 10 && diffMins > 0){
        const minsLeft = Math.round(diffMins);
        const tag = `10m-${task.id}-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${Math.floor(now.getMinutes()/10)}`;
        await notify(
          `🔴 ${minsLeft} minuto na lang! ${name}`,
          `Malapit nang mag-expire!${proj}`,
          tag
        );
        continue;
      }

      // ── WITHIN 1 DAY (up to 1440 mins): every 1 hour ──
      if(diffMins <= 1440){
        const tag = `repeat-${task.id}-${hourSlot(now)}`;
        let msg = '';
        if(diffMins <= 60){
          msg = `🔴 ${Math.round(diffMins)} minuto na lang!`;
        } else if(diffMins <= 180){
          msg = `🟠 ${Math.round(diffMins/60*10)/10} oras na lang!`;
        } else if(diffMins <= 360){
          msg = `🟡 ${Math.round(diffMins/60)} oras na lang!`;
        } else {
          const hrs = Math.round(diffMins/60);
          msg = `📅 ${hrs} oras pa bago mag-deadline!`;
        }
        await notify(
          `${msg} ${name}`,
          `Hindi pa tapos!${proj}`,
          tag
        );
        continue;
      }

      // ── MORE THAN 1 DAY: once-a-day morning reminder (8am) ──
      if(now.getHours() === 8 && now.getMinutes() < 15){
        const daysLeft = Math.floor(diffMins / 1440);
        const tag = `daily-${task.id}-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        await notify(
          `📋 ${daysLeft} araw pa bago mag-deadline! ${name}`,
          `Huwag kalimutan!${proj}`,
          tag
        );
      }
    }
  } catch(err) {}
}

async function notify(title, body, tag){
  // Each unique tag = unique notification slot
  // Different tags per time-slot = allows repeat firing
  const existing = await self.registration.getNotifications({tag});
  if(existing.length > 0) return;

  await self.registration.showNotification(title, {
    body,
    tag,
    icon: '/task-tracker/icon-192.png',
    badge: '/task-tracker/icon-192.png',
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200]
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
