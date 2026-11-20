# 고객 환경에서 AI에게 전달할 요청

아래 요청을 이 폴더를 연 AI 코딩 도구에 전달합니다. AWS 키나 워크숍 비밀번호를
요청문에 붙이지 않습니다. 고객 설정은 로컬 파일과 AWS 자격 증명 체인으로 제공합니다.

```text
이 프로젝트를 고객 소유 AWS 환경에서 재구성할 수 있게 분석하고 준비해 줘.

먼저 AGENTS.md, docs/product-value.md, server/prompts/prd-coach.md,
public/workshop.js, docs/ai-dlc-alignment.md, docs/customer-setup.md를 깊이 읽어.
핵심 가치를 설명하고, 코치 Instruction과 서버가 각각 보장하는 범위를 구분해.

현재 빈 AWS 설정은 의도된 배포 전 상태야. 과거 작성자의 계정, 배포 주소,
Cognito 값, 로그를 찾아 복원하지 마. 필요한 고객 입력만 목록으로 정리해:
- 고객 AWS 계정 ID, 사용할 리전과 자격 증명 프로필 또는 역할
- 새 스택 이름
- ConverseStream과 JSON Schema 구조화 출력을 지원하는 Bedrock 모델/프로필
- 선택한 모델과 추론 프로필에 필요한 정확한 리소스 ARN

우선 .env.example과 config/deployment.example.json으로 고객용 로컬 설정을 준비하고,
값이 미정이면 빈칸으로 둬. 계정/풀/클라이언트 ID나 배포 주소를 추정하지 마.
로컬 기본 상태에서는 모델을 호출하지 않고 화면과 문서 예시만 확인해.
npm run check, npm test, npm run verify:handoff를 수행하고 결과를 설명해.

7개 주제, 미정 보존, 사용자의 선택·전송, Q1~Q7 근거, FR/NFR/AC,
로컬 MVP·단일 Unit of Work·기본 제외 항목, 사용자 검토 상태를 유지해.
Instruction을 일반 PRD 프롬프트로 축약하지 마.
Helper의 AWS 호스팅과 생성 PRD의 로컬 MVP 범위를 혼동하지 마.

실제 호출과 배포가 요청되면:
1. 고객이 지정한 모델의 API 호환성과 호출 권한을 소규모 합성 입력으로 검증해.
   다른 모델로 자동 대체하거나 구조화 출력 검증을 삭제하지 마.
2. python3 scripts/deploy.py로 오프라인 설정 검증을 수행해.
3. 고객의 배포 지시 후 --apply를 실행해. 기존 스택 갱신은 --update-existing을
   명시할 때만 진행하고, STS 계정 일치 검사를 제거하지 마.
4. Cognito, DynamoDB, Lambda, CloudFront, S3, Scheduler 역할을 고객 스택에서
   생성하고 출력값을 사용해. Cognito JWT 검증과 대화 소유권 검증을 유지해.
5. 임시 워크숍 계정을 고객의 실제 시작·종료 시각으로 만들고 로그인, 다중 로그인
   대화 분리, 스트리밍, 검토·다운로드, 만료와 폐기를 검증해.
6. 비로그인/위조 토큰 거절, 원본 직접 접근 거절도 확인해.

새 검증 결과만 보고하고, 정적 분석·오프라인 fixture·실제 Bedrock·배포·브라우저
검증을 구분해. 마지막으로 비공개 설정과 계정 파일을 제외하여 다시 패키징해.
```

## 입력과 생성 결과의 구분

| 항목 | 어디서 얻는가 |
|---|---|
| AWS 계정, 리전, 프로필/역할, 스택 이름 | 고객이 지정 |
| Bedrock 모델/프로필 ID, 허용 리소스 ARN | 고객 계정의 Bedrock 모델·추론 프로필 조회 및 권한 검토 |
| Cognito UserPoolId / ClientId | CloudFormation이 새로 생성 |
| S3, DynamoDB, Lambda, CloudFront 주소/ID | CloudFormation Outputs |
| 워크숍 비밀번호 | 운영 스크립트가 무작위 생성, 비공개 로컬 파일 저장 |
| 대화 접근 키 | 서버가 대화 생성 시 무작위 생성, 탭 메모리에만 보관 |

`config/outputs.example.json`은 출력 구조를 설명하기 위한 빈 예시입니다.
실제 배포 결과는 `.local/deploy/release.json`에 저장하며, AI에게 그 전체를 붙일 필요는 없습니다.
