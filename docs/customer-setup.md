# 고객 환경 재구성

## 1. 로컬 화면과 자동 검사

Node.js 22 이상과 npm이 필요하다. 클라우드 재구성에는 Python 3와 AWS CLI v2도 필요하다.
이 프로젝트는 일반 Node.js 애플리케이션이며 별도의 사내 빌드 도구가 필요하지 않다.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm start
```

`http://127.0.0.1:4319/`에서 초기 화면·가이드·정적 예시 문서를 볼 수 있다.
Bedrock 비활성 상태에서는 대화를 시작할 수 없다. 다른 실행 환경의 설정이 이미
환경 변수로 주입되어 있으면 그 값이 `.env`보다 우선하므로 먼저 확인한다.

## 2. Bedrock 연결

```sh
cp .env.example .env
```

| 변수 | 고객이 설정할 값 |
|---|---|
| `BEDROCK_ENABLED` | 실제 대화를 시작할 때 `true` |
| `AWS_REGION` | 고객이 사용할 리전 |
| `AWS_PROFILE` | 로컬 AWS 프로필 이름. 역할/환경 자격 증명 체인을 쓰면 빈 값 유지 |
| `BEDROCK_MODEL_ID` | 고객 계정에서 사용 가능한 모델 ID 또는 추론 프로필 ID/ARN |
| `BEDROCK_MODEL_LABEL` | 화면 표시용 일반 모델 이름. 생략하면 `Bedrock`. 계정 ID/ARN 입력 금지 |
| `PORT` | 기본 4319. 서버는 `127.0.0.1`에만 바인딩 |

AWS 접근 키·세션 토큰을 이 파일에 추가하거나 소스에 넣지 않는다.
로컬 개발은 고객이 승인한 AWS CLI 로그인/프로필을, Lambda는 실행 역할을 사용한다.
필요 호출 권한은 선택한 리소스의 `bedrock:InvokeModel`,
`bedrock:InvokeModelWithResponseStream`이다.

선택 모델은 **Converse/ConverseStream 및 JSON Schema 구조화 출력**을 지원해야 한다.
모든 Bedrock 모델이 이 요청 형식을 지원한다고 가정하면 안 된다. 모델 접근 자격,
추론 프로필 사용 조건, 리전과 SDK 호환성은 고객 환경에서 확인한다.
호환되지 않으면 명시적으로 다른 지원 모델을 선택하거나 어댑터 변경을 검토한다.
자동 대체, JSON 검증 삭제, 실패 응답의 강제 수락은 하지 않는다.

```sh
npm run probe:bedrock
# 별도 터미널에서 npm start로 실행한 로컬 서버를 대상으로 한다.
npm run test:live
```

두 명령은 실제 Bedrock 사용료가 발생한다. 합성 입력을 쓰며, 두 번째 명령은 복수 대화,
7개 답변, 보류, 출처, 검토를 검사한다. 현재 로컬 설정을 수정했다면 서버도 재시작한다.

## 3. 고객 배포 설정

```sh
cp config/deployment.example.json config/deployment.json
```

모든 빈 값을 고객 정보로 채운다. `awsProfile`만 자격 증명 체인을 쓰는 경우 빈 값으로 둘 수 있다.

| 설정 | 의미 |
|---|---|
| `region` | Helper 리소스를 만들 고객 리전 |
| `stackName` | 고객이 선택한 새 CloudFormation 스택 이름 |
| `expectedAccountId` | 현재 AWS 자격 증명이 가리켜야 하는 고객 계정의 12자리 ID |
| `awsProfile` | 배포·운영 도구에서 사용할 프로필. 비어 있으면 표준 자격 증명 체인 |
| `modelId` | 선택한 Bedrock 모델/추론 프로필 |
| `bedrockResourceArns` | 선택한 모델/프로필 호출에 필요한 정확한 ARN 배열 |

로컬 `.env`는 로컬 앱/모델 검사에 사용하고, `config/deployment.json`은 배포·계정 운영에
사용한다. 고객이 두 경로를 같이 사용할 때 모델과 리전을 맞춘다. 도구가 암묵적으로
한 설정으로 다른 설정을 덮어쓰지 않는다.

직접 모델을 호출한다면 해당 리전의 foundation-model ARN을 입력한다.
추론 프로필을 쓴다면 프로필 ARN과 그 프로필이 연결하는 대상 리전의 모델 ARN을 포함한다.
고객 계정에서 아래 읽기 명령으로 확인하고, 선택한 프로필의 현재 반환값을 사용한다.

```sh
aws sts get-caller-identity --profile "$CUSTOMER_PROFILE"
aws bedrock get-inference-profile \
  --region "$CUSTOMER_REGION" --profile "$CUSTOMER_PROFILE" \
  --inference-profile-identifier "$CUSTOMER_MODEL_ID"
```

위 셸 변수는 고객이 먼저 지정해야 한다. 자격 증명 체인을 사용하면 `--profile`을 생략한다.
foundation-model을 직접 사용할 때는 추론 프로필 조회가 필요하지 않다.
이 전달본은 상용 AWS 파티션의 기존 구현을 기준으로 하며 중국/GovCloud 호환성을 검증하지 않았다.
Bedrock 권한을 편하게 맞추려고 `Resource: "*"`로 넓히지 않는다.

## 4. 오프라인 계획과 실제 배포

```sh
python3 scripts/deploy.py
```

이 명령은 설정을 검증하고 계획만 표시한다. AWS 호출·리소스 생성이 없다.
빈 설정은 오류로 중단한다. 실제 배포를 요청한 경우:

```sh
python3 scripts/deploy.py --apply
# 의도한 고객 스택을 갱신할 때만:
python3 scripts/deploy.py --apply --update-existing
```

실제 실행은 STS 계정 일치를 먼저 확인한다. CloudFormation/IAM, Lambda, DynamoDB,
Cognito, S3, CloudFront, Scheduler 역할을 만들 수 있는 고객 권한과 필요한 서비스
할당량이 필요하다. 템플릿에 필요한 작업을 검토하여 고객의 배포 역할로 실행한다.

S3와 Function URL은 비공개 원본이며 CloudFront OAC를 사용한다. API는 Cognito
서명을 검증하고, 계정 이용 기간·로그인 인스턴스·대화 접근 키를 확인한다.
빈 원본/거절용 초기 함수 → 비로그인 차단 확인 → 실제 API → 차단 재확인 →
공개 로그인 화면과 정적 애플리케이션 파일 순서로 배포한다.
정적 앱과 로그인 설정은 공개 가능하며, 고객 대화는 인증 API에서만 제공한다.

배포 출력은 `.local/deploy/release.json`에 저장한다. Cognito UserPoolId/ClientId,
테이블, Lambda, 원본과 배포 주소는 CloudFormation에서 새로 생성한다.
`USER_POOL_ID`, `CLIENT_ID`, `TABLE_NAME`, `BEDROCK_MODEL_ID`, `PUBLIC_ORIGIN`은
Lambda 환경으로 주입되므로 브라우저 소스나 코치 Instruction을 수정할 필요가 없다.
`config/outputs.example.json`은 값이 모두 비어 있는 출력 형식 예시다.

이 템플릿의 Cognito 로그인은 관리자 발급 워크숍 계정·비밀번호 방식이며 MFA는 꺼져 있다.
SSO/MFA가 필요한 고객은 로그인 UI와 Cognito 설정을 함께 확장하고 별도 검증해야 한다.
상시 운영 서비스, 사용자 셀프 가입, 대화 복원, 대규모 부하를 완성한 구성이 아니다.

## 5. 고객 계정에서 검증

[계정 운영 안내](workshop-operations.md)에 따라 실제 일정을 지정해 계정을 발급한다.
비밀번호는 `.local/accounts/`의 비공개 파일에서 운영자가 확인한다.

```sh
node scripts/verify-deployed.mjs .local/accounts/CUSTOMER_ACCOUNT_FILE.json --run-live
```

이 명령은 실제 모델 호출, 4회 로그인, 임시 만료 검증 계정 생성·삭제를 수행한다.
계정 파일이 현재 배포 스택과 일치하는지도 먼저 검사한다.
실제 고객 데이터를 입력하기 전에 [검증 항목](verification.md)을 확인한다.
종료 시각은 수 분 이상의 여유를 두고, 테스트 오류로 중단된 임시 계정은 운영 도구로 폐기한다.

## 6. 다시 전달할 때

`npm run package:handoff`는 전달 목록의 파일만 새 임시 폴더에 복사하고 검사한 뒤 ZIP을 만든다.
`.env`, 실제 배포 설정, 계정 파일, 로그, 의존성, 배포 아카이브는 포함하지 않는다.
추가 코드가 생기면 `handoff-files.json`을 의도적으로 갱신하고 내용을 검토한다.
전달 검사는 식별정보의 알려진 패턴과 빈 예시 설정 검사이며 모든 기밀을 판정하는 도구는 아니다.
