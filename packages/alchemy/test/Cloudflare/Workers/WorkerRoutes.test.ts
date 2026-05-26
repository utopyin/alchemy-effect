import { CloudflareEnvironment } from "@/Cloudflare/CloudflareEnvironment";
import * as Cloudflare from "@/Cloudflare/index.ts";
import * as Test from "@/Test/Vitest";
import * as workers from "@distilled.cloud/cloudflare/workers";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as pathe from "pathe";
import { expectUrlAbsent, expectUrlContains } from "../Utils/Http.ts";
import { waitForWorkerToBeDeleted } from "../Utils/Worker.ts";

const { test } = Test.make({ providers: Cloudflare.providers() });

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

const main = pathe.resolve(import.meta.dirname, "fixtures/worker.ts");

const zoneName =
  process.env.CLOUDFLARE_TEST_WORKER_ROUTE_ZONE_NAME ??
  process.env.CLOUDFLARE_TEST_R2_DOMAIN_ZONE_NAME ??
  "alchemy-test-2.us";

const routeSuffix = `alchemy-worker-route-${process.env.PULL_REQUEST ?? process.env.USER}`;
const routePattern = `${zoneName}/${routeSuffix}/api/*`;
const routeMatchUrl = `https://${zoneName}/${routeSuffix}/api/ping`;
const routeMissUrl = `https://${zoneName}/${routeSuffix}/unknown`;
const workerMarker = "Hello from TestWorker";

const findRoute = (zoneId: string, pattern: string, scriptName: string) =>
  workers
    .listRoutes({ zoneId })
    .pipe(
      Effect.map((response) =>
        (response.result ?? []).find(
          (route) => route.pattern === pattern && route.script === scriptName,
        ),
      ),
    );

test.provider.skipIf(!zoneName)(
  "creates, updates, and deletes worker zone routes",
  (stack) =>
    Effect.gen(function* () {
      const { accountId } = yield* CloudflareEnvironment;

      yield* stack.destroy();

      let workerName: string | undefined;

      yield* Effect.gen(function* () {
        const worker = yield* stack.deploy(
          Effect.gen(function* () {
            return yield* Cloudflare.Worker("RouteWorker", {
              main,
              url: false,
              routes: [{ pattern: routePattern, zoneName }],
            });
          }),
        );
        workerName = worker.workerName;

        expect(worker.routes).toHaveLength(1);
        expect(worker.routes[0]?.pattern).toEqual(routePattern);

        const zoneId = worker.routes[0]!.zoneId;
        const liveRoute = yield* findRoute(
          zoneId,
          routePattern,
          worker.workerName,
        );
        expect(liveRoute?.pattern).toEqual(routePattern);
        expect(liveRoute?.script).toEqual(worker.workerName);

        yield* expectUrlContains(routeMatchUrl, workerMarker, {
          label: "worker route match",
          timeout: "60 seconds",
        });

        yield* expectUrlAbsent(routeMissUrl, workerMarker, {
          label: "worker route miss",
          timeout: "30 seconds",
        });

        const updated = yield* stack.deploy(
          Effect.gen(function* () {
            return yield* Cloudflare.Worker("RouteWorker", {
              main,
              url: false,
              routes: [],
            });
          }),
        );

        expect(updated.routes).toHaveLength(0);

        const deletedRoute = yield* findRoute(
          zoneId,
          routePattern,
          worker.workerName,
        );
        expect(deletedRoute).toBeUndefined();
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* stack.destroy().pipe(Effect.ignore);
            if (workerName) {
              yield* waitForWorkerToBeDeleted(workerName, accountId).pipe(
                Effect.ignore,
              );
            }
          }),
        ),
      );
    }).pipe(logLevel),
  { timeout: 240_000 },
);
