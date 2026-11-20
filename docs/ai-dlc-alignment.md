# AI-DLC 워크숍 PRD 코치의 역할

원본 설계가 2026-11-13에 참조한 공식 저장소 커밋 `7752f3b6d9a00f291c487e1536531544a82113d0`의 문서를 근거로 한다. 이 전달본에서는 해당 문서의 최신성을 다시 검증하지 않았다. 전체 AI-DLC 엔진을 실행하거나 정식 단계 승인을 대신하는 도구가 아니다.

## 확인한 공식 근거

- [AI-DLC principles](https://github.com/awslabs/aidlc-workflows/blob/7752f3b6d9a00f291c487e1536531544a82113d0/core/knowledge/aidlc-shared/ai-dlc-principles.md): User decides, adaptive depth, traceable artifacts, questions before assumptions, contradiction detection.
- [Vision document guide](https://github.com/awslabs/aidlc-workflows/blob/7752f3b6d9a00f291c487e1536531544a82113d0/docs/guide/writing-inputs/vision-document-guide.md): 무엇을·누구를 위해·왜 만드는지, 첫 릴리스 IN/OUT, 미확정 질문이 AI-DLC의 입력이다. 전체 비전과 첫 릴리스의 범위를 구분한다. 문서는 데이터이며 승인 절차는 유지된다.
- [Intent capture](https://github.com/awslabs/aidlc-workflows/blob/7752f3b6d9a00f291c487e1536531544a82113d0/core/aidlc-common/stages/ideation/intent-capture.md): 미정/해당 없음 선택지를 제공하고, 선택하지 않은 옵션을 요구사항으로 만들지 않는다. 확인된 답변의 출처와 가정을 구분한다.
- [Requirements analysis](https://github.com/awslabs/aidlc-workflows/blob/7752f3b6d9a00f291c487e1536531544a82113d0/core/aidlc-common/stages/inception/requirements-analysis.md): 기능·비기능·사용 시나리오·비즈니스·기술 맥락·품질을 살핀다. FR/NFR ID, 제약, 가정, 제외 항목과 미확정 질문을 남긴다. 정식 분석의 미해결 모호함은 질문으로 해소한다.

## 제품에 반영

| 원칙 | 코치 동작 |
|---|---|
| 의도 우선 | 아이디어 → 사용자/문제 → 핵심 흐름 |
| 작은 가치 단위 | 최소 완결 흐름과 소수의 필수 기능을 제안 |
| 사용자 결정 | 추천 클릭은 입력만 채운다. 전송 후 기록하며, 마지막에 문서를 검토·확정 |
| 추측보다 질문 | 잘못된 필드 저장·모순·공통 원칙 위반은 진행하지 않음 |
| 미정 허용 | 항상 “AI-DLC를 진행하면서 구체화할 예정이에요.” 제공. 미정 항목을 확정 사실로 쓰지 않음 |
| 추적성 | 원문 Q1~Q7, 요약, 요구사항의 출처, 검토 상태 보존 |
| 설계 여지 | 합의하지 않은 스택·아키텍처·KPI를 생성하지 않음 |
| 안전한 인계 | PRD는 입력 문서. 단계 완료/승인 기록이나 AI-DLC 상태 파일을 만들지 않음 |

## 이 워크숍의 고정 전제

아래는 AI-DLC 전체가 강제하는 규칙이라는 주장이 아니라, 사용자가 이 워크숍에 정한 기준이다.

- 코치 기능은 요구사항·설계 정리와 PRD Markdown 생성.
- 결과 제품은 로컬에서 빌드·실행하는 MVP. 컨테이너 사용이나 개수는 미리 제한하지 않는다.
- **AI-DLC 개발 Unit of Work는 단일 유닛으로 진행한다.**
- 기간/소요 시간 설정 없음. 구현 목표 선택 없음.
- 다국어, 결제·구독·사용량 과금, 수십만 건 이상의 대용량 처리, 캐시/CDN 제외.
- 프로덕션 배포, CI/CD, IaC, APM/모니터링 인프라, 장애/재해 복구 제외.
- 기본 제외 항목과 단일 유닛·로컬 원칙은 생성·수정·확정·다운로드 경로 모두에 유지.

## 문서 인계

프로젝트 루트에 `prd.md`를 저장하고, 설정된 AI-DLC에서 파일을 이름으로 참조한다:

```text
/aidlc Read ./prd.md and use it as the starting requirements for a locally runnable MVP. Keep a single Unit of Work, confirm open questions, and preserve the workshop exclusions.
```

Codex용 호출은 `$aidlc`를 사용한다. 이 안내는 사용자가 실행할 시작 요청 예시이며, 코치가 실제 워크플로우를 시작하거나 승인하지 않는다.

## Instruction

검토 가능한 원본은 `server/prompts/prd-coach.md`. 각 호출은 해당 대화의 현재 질문, 확인된 답변과 새로운 사용자 답변만 전달한다. 모델 실패나 형식 불일치 시 기록과 단계를 갱신하지 않는다.
