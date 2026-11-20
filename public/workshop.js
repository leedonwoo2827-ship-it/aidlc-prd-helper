export const DEFER_ANSWER = 'AI-DLC를 진행하면서 구체화할 예정이에요.';
export const WORKSHOP_GOAL = '이번 워크숍의 목표는 로컬에서 빌드하고 실행할 수 있는 MVP입니다.';
export const SINGLE_UNIT_RULE = 'AI-DLC 개발 Unit of Work는 단일 유닛으로 진행한다.';
export const CONTRACT_VERSION = 'workshop-local-single-unit-v1';
export const CONTRACT_MARKDOWN = `## 워크숍 공통 개발 원칙

- 이번 워크숍의 목표는 로컬에서 빌드하고 실행할 수 있는 MVP이다.
- ${SINGLE_UNIT_RULE}
- 프런트엔드·백엔드·데이터 처리는 하나의 Unit of Work 안에서 함께 설계·구현·검증한다.
- 로컬 개발 환경에서 빌드하고 실행할 수 있어야 한다.
- 이 문서는 AI-DLC 개발을 시작하기 위한 PRD·요구사항 명세 초안이다. AI-DLC의 요구사항 구체화와 사용자 승인 절차는 실제 워크플로우에서 진행한다.

## 제외 기능 (구현하지 않음)

### 배포 및 운영

- 프로덕션 배포 (AWS, K8s 등)
- CI/CD 파이프라인
- IaC 자동화
- APM / 모니터링 인프라
- 장애 복구 / 재해 복구 체계

### 결제 / 구독 / 부하

- 결제 처리
- SaaS 구독 관리, 사용량 과금
- 대용량 처리 (수십만 건 이상)
- 캐시 / CDN

### 언어

- 다국어 지원`;
const START = '<!-- workshop-contract:start -->';
const END = '<!-- workshop-contract:end -->';
export function enforceWorkshopContract(markdown) {
  // This block is server/product policy, outside the editable customer requirements.
  const content = String(markdown).replace(/<!-- workshop-contract:start -->[\s\S]*?<!-- workshop-contract:end -->\s*/g, '').trim();
  const lines = content.split('\n');
  const title = lines[0]?.startsWith('# ') ? lines.shift() : '# 워크숍 MVP PRD';
  return `${title}\n\n${START}\n${CONTRACT_MARKDOWN}\n${END}\n\n${lines.join('\n').trim()}\n`;
}
export function isDeferred(text) {
  return /^(?:AI-DLC[를을]?\s*진행하면서\s*구체화.{0,12}|아직\s*(?:정하지\s*못|모르).{0,10}|미정.{0,6}|추후\s*구체화.{0,10})[.!。 ]*$/i.test(text.trim());
}
export function withDeferOption(suggestions, complete = false) {
  if (complete) return [];
  return [...suggestions.filter(s => !isDeferred(s)).slice(0, 3), DEFER_ANSWER];
}
