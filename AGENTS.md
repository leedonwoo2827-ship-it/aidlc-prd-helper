# 이 프로젝트를 분석·재구성하는 AI를 위한 지침

수정 전에 `README.md`, `docs/product-value.md`, `server/prompts/prd-coach.md`,
`public/workshop.js`, `docs/ai-dlc-alignment.md`, `docs/customer-setup.md`를 읽는다.

## 제품의 목적

고객의 의도를 AI-DLC 시작 입력으로 만드는 PRD 코치다. 일반 챗봇, 코드 생성기,
전체 AI-DLC 실행 엔진, 정식 Requirements Analysis 승인 도구로 바꾸지 않는다.
이 Helper의 배포와 생성 PRD가 정하는 고객 제품의 구현 범위를 구분한다.

## 반드시 유지할 동작

- 7개 주제, 한 번에 하나의 문맥에 맞는 질문, 선택 후 수정 가능한 추천 답변.
- 추천을 선택하지 않았거나 전송하지 않았다면 확정된 요구사항으로 만들지 않는다.
- 미정·보류 답변은 유효한 진행이며, 기술·KPI·수치·담당자를 지어내어 채우지 않는다.
- Q1~Q7 원문과 요약, FR/NFR/AC 출처, 사용자 검토 상태를 보존한다.
- 로컬 MVP·단일 Unit of Work·기본 제외 항목은 모든 문서 경로에서 유지한다.
- 단일 유닛을 단일 컨테이너와 혼동하거나 Docker를 필수로 만들지 않는다.
- 모델 스트림은 임시 표시이며, 검증된 완료 응답만 답변·단계·PRD에 반영한다.
- 프롬프트의 의미 검증 책임과 코드의 형식/출처 검증 범위를 혼동하지 않는다.
- 대화 수정 시 이후 답변을 재확인하고, 직접 편집은 기존 검토 완료를 무효화한다.
- 인증, 로그인 인스턴스, 대화 접근 키, revision, 잠금, 중복 요청 방지를 유지한다.

## 설정 재생성

현재 빈 설정은 의도된 전달 상태다. 기존 계정 정보를 찾아 복원하거나 임의 값으로
채우지 않는다. `config/deployment.example.json`과 `.env.example`을 바탕으로 고객이
선택한 계정·리전·모델을 입력받는다. ID·ARN·주소는 고객 계정에서 실제 생성하거나
조회한 출력으로 채운다. Cognito ID를 만들어내거나 public 코드에 하드코딩하지 않는다.

AWS 자격 증명은 SDK/CLI의 자격 증명 체인으로 제공한다. 비밀번호·키·JWT를 소스,
Instruction, AI 대화, 로그에 기록하지 않는다. `.env`, `.local`, 실제 배포 설정,
계정 JSON은 전달 목록에 추가하지 않는다.

기본 로컬 실행은 `127.0.0.1`과 Bedrock 비활성이다. Cognito가 미설정됐다고
클라우드 인증을 우회하지 않는다. 다른 모델로 자동 대체하지 않는다.
모델 변경 시 ConverseStream과 JSON Schema 구조화 출력 지원을 고객 계정에서 확인한다.

## 실행과 검증

`npm run check`, `npm test`, `npm run verify:handoff`는 AWS 없이 수행한다.
실제 모델 호출은 `npm run probe:bedrock`, `npm run test:live`로 구분한다.
클라우드 생성은 `python3 scripts/deploy.py --apply`이며 비용과 리소스 변경이 따른다.
배포 요청이 없는 코드 분석·수정 작업에서는 오프라인 검증까지만 수행한다.

재구성 요청은 `AI-REBUILD.md`를 따른다. 사용자에게 무엇을 보존했고 무엇을 바꿨는지,
자동 검사·합성 fixture·실제 모델·실제 배포·브라우저 검증의 범위를 구분해 보고한다.
공유 전 `npm run package:handoff`로 허용 목록만 패키징한다.
