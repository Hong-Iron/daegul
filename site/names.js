// 랭킹 이름 규칙과 비속어 거르기. 게임 화면과 랭킹 서버(rank/src/index.js)가 이 파일 하나를 같이 쓴다.
// 거르는 방식: 공백·기호를 지운 글자열, 한글만 남긴 글자열(시1발 → 시발), 숫자를 비슷한 영문자로 바꾼 글자열(sh1t → shit)에서
// 아래 목록의 패턴을 찾는다. 완벽하지 않으니 새로 보이는 말은 목록에 더한다.
export const NAME_MIN = 2, NAME_MAX = 10;
const ALLOWED = /^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 _.\-]+$/;

const KO = [
  /[시씨쒸쉬싀씌쓔슈][이ㅣ]?[발빨벌뻘펄팔바빠봘]/, /[ㅅㅆ][ㅂㅃ]|ㅄ|ㅂㅅ|ㅈㄹ|ㅁㅊ|ㅈㄴ|ㄷㅊ|ㄲㅈ|ㅗ/,
  /[병븅빙뵹][신싄딱맛]/, /좆|좃|졷|좇|조까/, /[존졸][나내]|졸라/, /[지즤]랄/,
  /개[새색쉐썌섀세][끼키기퀴]?/, /[새쌔섀][끼키]/, /미[친췬칀]|미쳤/, /[섹쎅][스쓰]/, /[보자][지짓]/,
  /니[애에]?[미비]|느[금검]|[애에][미비]|[엠앰]창/, /엿[먹머]/, /닥[쳐처치]/, /꺼[져저]/,
  /염병|썅|쌍[년놈]|화냥|창[녀년]|걸레|후장|딸[딸치]|등신|또라이|[찐짠]따|애자|장애인/,
  /한남|김치녀|일베|메갈|워마드|운지|노무/, /관리자|운영자|운영진|개발자/, /자살|살인|강간|성폭/,
];
const EN = [
  /fu+c?k|fck|fuk|phuck|shit|bitch|biatch|asshole|dick|pussy|cunt|nigg|fag|porn|sex|penis|vagina|rape|whore|slut|retard|bastard|motherf|stfu/,
  /hitler|nazi|admin|moderator|operator/,
  // 한글 욕을 영문 자판으로 친 것: 시발 tlqkf, 병신 qudtls, 지랄 wlfkf, 존나 whssk, 미친 alcls, 새끼 toRl
  /tlqkf|tlqk|qudtls|wlfkf|whssk|alcls|torl|sibal|ssibal|shibal|byungsin|jiral|jonna/,
];

export const cleanName = (raw) => String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
// two spellings of the same name share a ranking row: case and spaces do not count
export const nameKey = (name) => cleanName(name).toLowerCase().replace(/\s+/g, '');

export function isBad(name) {
  const low = cleanName(name).toLowerCase();
  const flat = low.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-z0-9]/g, '');
  const ko = flat.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
  const en = flat.replace(/[^a-z0-9]/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
    .replace(/5/g, 's').replace(/7/g, 't').replace(/(.)\1+/g, '$1');
  return KO.some((r) => r.test(ko) || r.test(flat)) || EN.some((r) => r.test(en) || r.test(flat));
}

export function checkName(raw) {
  const name = cleanName(raw), n = [...name].length;
  if (n < NAME_MIN) return { ok: false, why: `${NAME_MIN}글자 이상 써 주세요` };
  if (n > NAME_MAX) return { ok: false, why: `${NAME_MAX}글자까지 쓸 수 있어요` };
  if (!ALLOWED.test(name)) return { ok: false, why: '한글, 영문, 숫자만 쓸 수 있어요' };
  if (isBad(name)) return { ok: false, why: '쓸 수 없는 이름이에요' };
  return { ok: true, name };
}
