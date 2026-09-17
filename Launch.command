#!/bin/zsh
cd "${0:A:h}"
if ! curl -fsS --max-time 2 http://127.0.0.1:47831/api/status >/dev/null; then
  if [ ! -d node_modules ]; then npm ci || exit 1; fi
  nohup node server.mjs >/dev/null 2>&1 &
fi
for attempt in {1..30}; do
  if curl -fsS --max-time 1 http://127.0.0.1:47831/api/status >/dev/null; then
    printf 'Voice Browser: http://127.0.0.1:47831\n'
    open http://127.0.0.1:47831
    exit 0
  fi
  sleep 0.2
done
printf 'Локальный сервер не запустился. Выполните npm start для диагностики.\n' >&2
exit 1
