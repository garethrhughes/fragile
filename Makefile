.PHONY: install start stop clean reset

install:
	cd backend && npm install
	cd frontend && npm install

start:
	docker compose up -d
	cd backend && npm run start:dev &
	cd frontend && npm run dev &

stop:
	-pkill -f "nest start" || true
	-pkill -f "next dev" || true
	docker compose down

clean: stop
	docker compose down -v
	docker compose up -d
	sleep 2
	cd backend && npm run build
	cd backend && npm run migration:run

reset: stop
	docker compose down -v
	rm -rf backend/node_modules backend/dist frontend/node_modules frontend/.next
	$(MAKE) install
	docker compose up -d
	sleep 2
	cd backend && npm run build
