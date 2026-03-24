# シフト生成ロジック 変更ログ

## 2026-03-25: 条件チェックロジックのリファクタリング

### 背景
`scoreShifts()`（スコアリング）と`renderConditionsCheck()`（UIパネル表示）で
同一のチェックロジックが約400行にわたり二重実装されていた。
片方を修正してもう片方を忘れるとバグが発生する温床になっていた。

### 変更内容

#### 1. `runAllChecks()` 共通関数の導入
- 全チェック項目を実行し、構造化データ（`globalItems`, `staffChecks`, `bonusItems`）を返す
- `scoreShifts()` と `renderConditionsCheck()` の両方がこの結果を利用

#### 2. ヘルパー関数のモジュールレベル昇格
以下の関数を `renderConditionsCheck` 内部のクロージャからモジュールレベルに移動：
- `_staffAssignments`, `_workDays`, `_restDays`, `_countPattern`
- `_maxConsecutiveWork`, `_maxConsecutiveWorkIncludingDispense`
- `_countSundays`, `_checkConsecutiveRestPairs`
- `_restOverlap`, `_countCrossStore`, `_getWeeklyBreakdown`, `_dispenseCount`

#### 3. `scoreShifts()` の簡素化
- 旧: 独自にチェックを実行（〜160行）
- 新: `runAllChecks()`の結果から`scoreDelta`を合算するだけ（〜30行）

#### 4. `renderConditionsCheck()` の描画専用化
- 旧: 独自にチェックを実行（〜390行）
- 新: `runAllChecks()`の結果をUIに描画するだけ（〜105行）

### コード量の変化
- **Before**: 2320行
- **After**: 1993行（**-327行**）

---

## 2026-03-24: シフト生成ロジックの改善

### 中村の週またぎ連勤制限
- `canWork()`に`alternating_weeks`に基づく連勤制限を追加
- 週の最大勤務日数を超える連勤を防止

### 小野の6連勤防止
- `computeRestDays()`に`enforceGaps`ロジックを追加
- 公休間に6日以上の空白が生じないよう強制的に休日を挿入

### 徳永の調剤日数考慮
- 調剤（dispense）日を月間出勤カウントの初期値に加算
- 17日目標に調剤日を含めることで、薬2への不要な配置を防止

### 条件チェックパネルの改善
- チェック項目の説明文を詳細化
- 優先順位順にソート（絶対 > 高 > 中 > 低）
- 徳永の「調剤」オプション表示を修復

### 配置アルゴリズムの修正
- `tryAssignOffice()`のスコア計算で、店舗優先順位をペーシングより重視するよう変更
