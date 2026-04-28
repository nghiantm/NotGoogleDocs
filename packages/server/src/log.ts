export const log = {
  info: (event: string, data?: object) =>
    console.log(JSON.stringify({ level: 'info', event, ...data, ts: Date.now() })),
  error: (event: string, data?: object) =>
    console.error(JSON.stringify({ level: 'error', event, ...data, ts: Date.now() })),
}
