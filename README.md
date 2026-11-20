# AI-DLC PRD Helper · 고객 전달본

고객의 아이디어를 7개 주제의 대화로 정리하여, AI-DLC 개발을 시작할 때 읽을 PRD Markdown을 만드는 도구입니다. 사용자가 결정한 내용과 아직 모르는 내용을 구분하고, 요구사항의 근거와 사용자 검토 상태를 남깁니다.

이 폴더에는 제품 코드, 코치 Instruction, 인프라 템플릿과 재구성 도구가 들어 있습니다. AWS 계정·프로필·모델 연결값은 비워 두었습니다. 기존 환경의 자격 증명, 배포 주소, Cognito ID, 고객 대화, 계정 파일과 검증 기록은 포함하지 않습니다.

## Windows 빠른 시작 (Claude Code / Codex CLI OAuth)

API 키나 AWS 계정 없이, PC에 **로그인된 Claude Code CLI 또는 Codex CLI**의 구독(OAuth)으로 AI 코치를 실행합니다.

1. 준비: Node.js 22 이상, 그리고 둘 중 하나
   - Claude Code: `npm install -g @anthropic-ai/claude-code`
   - Codex: `npm install -g @openai/codex`
   - 로그인은 웹 화면 오른쪽 위 **로그인** 버튼으로 합니다 (새로고침·로그아웃 버튼도 있음)
2. `setup.bat` 더블클릭 → 입력 없이 자동 진행: 패키지 설치, 설치된 CLI 감지(Claude 우선), `.env` 생성(포트 4319, 이미 있으면 유지)
3. `run.bat` 더블클릭 → 브라우저가 <http://127.0.0.1:4319/> 로 열림 (`localhost`가 아니라 `127.0.0.1`로 접속해야 합니다)

설정은 `.env`의 `COACH_PROVIDER`(`claude` | `codex` | `bedrock`), `COACH_MODEL`(선택, Claude 기본 `sonnet`), `PORT`로 바꿀 수 있습니다. 답변 한 번에 CLI를 한 번 호출하며 10초 안팎이 걸리고, 마지막 PRD 생성 단계는 더 오래 걸립니다.

## 먼저 읽을 문서

1. [제품의 핵심 가치와 구현](docs/product-value.md)
2. [코치 Instruction 원문](server/prompts/prd-coach.md)
3. [AI-DLC 원칙과 제품의 대응](docs/ai-dlc-alignment.md)
4. [고객 환경 재구성 안내](docs/customer-setup.md)
5. [AI에게 전달할 재구성 요청](AI-REBUILD.md)

AI 코딩 도구가 이 프로젝트를 분석할 때 적용할 지침은 [AGENTS.md](AGENTS.md)에 있습니다.

## 설정 없이 살펴보기

Node.js 22 이상에서 실행합니다.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm start
```

접속: <http://127.0.0.1:4319/>

초기 화면, 안내, 예시 PRD를 확인할 수 있습니다. `.env`가 없으면 Bedrock은 꺼져 있으며 대화 생성은 `BEDROCK_DISABLED`로 거절됩니다. 예시 PRD는 설명용 정적 문서입니다. 모델 대화를 대신하는 기능은 아닙니다.

실제 대화를 사용하려면 `.env.example`을 `.env`로 복사하고 고객 리전·모델과 AWS 자격 증명 체인을 설정합니다. 접근 키를 소스나 브라우저에 넣지 않습니다. 상세 절차는 [재구성 안내](docs/customer-setup.md)를 따릅니다.

## 유지되는 제품 동작

- 의도 → 사용자/문제 → 핵심 흐름 → 기능 → 데이터/제약 → 범위 → 수용 기준.
- 추천 답변은 입력창만 채우며, 사용자가 전송해야 대화에 반영됩니다.
- 미정은 보류로 남기고 AI-DLC에서 이어서 확인합니다.
- PRD의 요구사항과 수용 기준에 Q1~Q7 근거를 연결합니다.
- 직접 수정, 초안 다운로드, 사용자 검토 후 `prd.md` 다운로드를 지원합니다.
- 생성·수정·검토·다운로드 경로에서 로컬 MVP, 단일 Unit of Work와 기본 제외 항목을 유지합니다.
- 실패한 모델 응답이나 형식·출처 검증 실패는 답변과 단계에 반영하지 않습니다.

코치는 AI-DLC 워크플로우를 실행하거나 정식 단계 승인을 대신하지 않습니다. 생성되는 PRD의 로컬 MVP 원칙은 **고객이 만들 제품**에 적용합니다. 이 Helper 자체를 Cognito·Lambda·DynamoDB·CloudFront로 운영하는 인프라는 별개입니다.

## 검사와 전달

```sh
npm run verify:handoff
npm run package:handoff
```

첫 명령은 `handoff-files.json`에 열거한 전달 파일의 빈 설정과 식별정보 패턴을 검사합니다. 두 번째 명령은 그 파일만 담은 ZIP을 `.local/handoff/prd-cde.zip`에 만듭니다. 재설정 후 `.env`, `config/deployment.json`, 계정 파일을 포함한 작업 폴더 전체를 공유하지 마세요.

[검증 범위](docs/verification.md)에는 이 전달본에서 수행한 검사와 고객 계정에서 다시 확인할 항목을 구분해 적었습니다.
