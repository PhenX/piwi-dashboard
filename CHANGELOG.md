# Changelog

## [0.9.0](https://github.com/PiwiTests/platform/compare/v0.8.0...v0.9.0) (2026-07-09)


### Features

* **cluster:** global-view diagnosis layout ([b5c7ba9](https://github.com/PiwiTests/platform/commit/b5c7ba9052ac757216fb5f2bef650de7ae7a062f))
* compress screenshots server-side via sharp before sending to AI ([3f3ed09](https://github.com/PiwiTests/platform/commit/3f3ed096857747c9b77981dc788276ff336b3fe4))
* **demo:** enrich step events with hooks/fixtures and add wait-heavy scenario ([201f3da](https://github.com/PiwiTests/platform/commit/201f3da98b1c03cd9cff4f3fd0ac7c5ce5a24be6))
* **demo:** enrich step events with hooks/fixtures and add wait-heavy… ([1fe644f](https://github.com/PiwiTests/platform/commit/1fe644fc029fa34bc64f5371dbc8d1859b2053cf))
* **diagnosis:** context coverage strip and citation reveal-on-page ([67f5625](https://github.com/PiwiTests/platform/commit/67f56259b993689c72d5cc770a289e78736c2830))
* **release:** adopt release-please for file-authoritative versioning ([#215](https://github.com/PiwiTests/platform/issues/215)) ([8e7b7cb](https://github.com/PiwiTests/platform/commit/8e7b7cb094c3abb8d990cb0fc4e79421215ad560))
* **reporter:** respect explicit `enabled` option ([4466da3](https://github.com/PiwiTests/platform/commit/4466da3766206a865fbd48ad0b904741e4c3f0e4))
* send test screenshots to AI and embed in HTML export ([d4fa1fd](https://github.com/PiwiTests/platform/commit/d4fa1fddd8c0297cad1bf7e131fef3c1f33d2795))
* send test screenshots to AI and embed in HTML export ([22471d7](https://github.com/PiwiTests/platform/commit/22471d78d73799d190e0125b280db03ffda51b08))
* **settings:** AI usage panel, per-role connection tests, form fixes ([b6419e2](https://github.com/PiwiTests/platform/commit/b6419e2c74464735962c37e444e9f8629ba0e4e8))
* **ui:** add CollapsibleSectionCard and useFoldedState primitives ([29bf152](https://github.com/PiwiTests/platform/commit/29bf1521fa3690375e515af9978fb3f22a05b2b2))
* **users:** replace Global Access toggle with radio group in Project Access modal ([bf05f4b](https://github.com/PiwiTests/platform/commit/bf05f4bf38bbdcd85318ad45a4c15ce9a747bdce))


### Bug Fixes

* account activation, display name editing, and user creation flow ([26c59e6](https://github.com/PiwiTests/platform/commit/26c59e67bf450d24cd0d1b4647a93f5a5a124582))
* actually register Nitro's OpenAPI route in production builds ([094ec06](https://github.com/PiwiTests/platform/commit/094ec0674d90fd5f84537918711de1c096ed332d))
* actually register Nitro's OpenAPI route in production builds ([b898e49](https://github.com/PiwiTests/platform/commit/b898e498d70986b47e6db71bac81cfd5e737ef9c))
* add waitForHydration before project link clicks and increase notification assertion timeouts ([a67b612](https://github.com/PiwiTests/platform/commit/a67b61242deb73caa8d60dd34d2cbb9bc9571f7e))
* **ai:** provider correctness + token-efficiency for model calls ([2c6a8e0](https://github.com/PiwiTests/platform/commit/2c6a8e0144210ef444b2b6675c5d37cebb98f5d6))
* **ai:** provider correctness + token-efficiency for model calls ([9e290fe](https://github.com/PiwiTests/platform/commit/9e290fe850f37698b648b30bd4f16418353fa57e))
* **api:** validate project/user IDs before inserting into project_assignments ([34fac99](https://github.com/PiwiTests/platform/commit/34fac998a54283c28cd0262a8ed36768ad46771b))
* **db:** make run-duration max and startTime comparison Postgres-safe ([900a359](https://github.com/PiwiTests/platform/commit/900a3594fd511e2c7246fdc1afb0b0fecc2afa54))
* **db:** widen test_runs_cases.started_at to bigint on Postgres ([66f9b1b](https://github.com/PiwiTests/platform/commit/66f9b1b770497d8d3e442294eaba99720abdea3d))
* **demo:** use 0-based step event offsets, remap to absolute time in … ([78a3dc9](https://github.com/PiwiTests/platform/commit/78a3dc9a4d854f7f385c1b02c3e6c25f351ac64e))
* **demo:** use 0-based step event offsets, remap to absolute time in workerLoop ([05a784c](https://github.com/PiwiTests/platform/commit/05a784c6b89a3c3a542c5003a8bd0e1fe1f3d4ca))
* generate OpenAPI spec during build hook, remove broken post-build script ([afc3519](https://github.com/PiwiTests/platform/commit/afc3519ee61f56a1a873f7a2e665d42d4ee640d2))
* **insights:** wire up demo route and add empty state explanations ([5177544](https://github.com/PiwiTests/platform/commit/5177544967a079f4dc966d17027b84c706645c8b))
* keep 4 side blocks on same rows as summary using row-span-2 ([bd2f0fb](https://github.com/PiwiTests/platform/commit/bd2f0fb15dfa2677d14755c8edc0c9b0a8a2fa23))
* keep 4 side blocks on same rows as summary using row-span-2 ([ccb8bea](https://github.com/PiwiTests/platform/commit/ccb8bea653b70a878063f876407d1a2f5a0cb761))
* make password truly optional in add user form ([ba4d5dc](https://github.com/PiwiTests/platform/commit/ba4d5dc44f307de40025c49882a29597a4fe786a))
* make password truly optional in add user form ([85317e7](https://github.com/PiwiTests/platform/commit/85317e76bfa4250e7d58040cdcda2baf3e0247ec))
* **members:** show all users in Members tab and remove avatar ([87c2b54](https://github.com/PiwiTests/platform/commit/87c2b54fe0eb7c6a99ea9fe21ba38dbbc6d94a6c))
* prerender /_openapi.json instead of generating it from handler meta ([c965030](https://github.com/PiwiTests/platform/commit/c9650300f556e528d8332aa27e02f114e2c539b6))
* prerender /_openapi.json instead of generating it from handler meta ([67711c6](https://github.com/PiwiTests/platform/commit/67711c615237488c31e2331c2097e8ae7e541cbf))
* publish Docker image to phenx/piwitests-server on Docker Hub ([a32637b](https://github.com/PiwiTests/platform/commit/a32637b2329a2ca56626dc7fb65f51657141269e))
* **reporter:** read serverUrl from inline reporter config in global setup ([e511482](https://github.com/PiwiTests/platform/commit/e511482b12953778f06c0e849be3e1f921388d70))
* **reporter:** remove trailing comma in package.json exports (invalid JSON) ([47ad757](https://github.com/PiwiTests/platform/commit/47ad75738a5018303daaa32a658430f0dfa37557))
* resolve test suite failures ([8d47b5c](https://github.com/PiwiTests/platform/commit/8d47b5ce1ac19a9710bda668d66537f957732c8d))
* single-row layout for 4 blocks — summary=4col, blocks=2col each ([94cdb0f](https://github.com/PiwiTests/platform/commit/94cdb0f27802cb1d3a93f1de63121f4e877c6938))
* stop demo simulator from double-counting totalTests ([51641e0](https://github.com/PiwiTests/platform/commit/51641e003fee86b0752452c4641e038012545dc8))
* **tests:** handle export default when requiring reporter in runner scripts ([32b758d](https://github.com/PiwiTests/platform/commit/32b758d274fae3e68edf94f56afb6d55cc142ed6))


### Reverts

* restore playwright.config.ts to original state ([0f39090](https://github.com/PiwiTests/platform/commit/0f39090e254be5f580171a4d4527cbca12302d42))

## [0.8.0](https://github.com/PiwiTests/platform/compare/v0.7.0...v0.8.0) (2026-07-09)


### Features

* **release:** adopt release-please for file-authoritative versioning ([#215](https://github.com/PiwiTests/platform/issues/215)) ([8e7b7cb](https://github.com/PiwiTests/platform/commit/8e7b7cb094c3abb8d990cb0fc4e79421215ad560))
