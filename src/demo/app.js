// Stand-in for `firebase/app` in demo mode.
export function initializeApp(config) {
  return { name: 'demo', options: config };
}
