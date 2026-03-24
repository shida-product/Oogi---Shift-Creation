# オオギ薬局 シフト作成ツール

## プロジェクト概要
オオギ薬局（恵比寿・渋谷）のスタッフ約8名が、スマートフォンやPCから毎月の「希望休」を提出し、それをもとにルールベースのアルゴリズムがシフト案を自動生成するWebアプリケーション。

---

## 技術スタック
| 項目 | 技術 |
|:--|:--|
| フロントエンド | HTML / CSS / JavaScript（Vanilla） |
| アイコン | [Lucide Icons](https://lucide.dev/)（SVG） |
| フォント | Inter / Noto Sans JP（Google Fonts） |
| バックエンド / DB | Supabase (PostgreSQL) |
| 認証 | なし（URLアクセス＋スタッフ選択） |
| ホスティング（予定） | GitHub Pages または Vercel |

---

## 画面構成

### メイン画面（`index.html`）
- **PC**: ガントチャート形式。ドラッグで複数日一括選択して希望休を登録。
- **スマホ**: カレンダー形式。日付タップで詳細表示・登録。
- 5種類の希望休に対応（休み希望 / 調剤 / AM可 / PM可 / その他）
  - 「調剤」は徳永専用。別薬局での勤務日を登録し、連勤制御に使用。
- 画面下部に「条件付き・その他の希望」リスト表示

### シフト生成画面（`generate.html`）
- 月を選択してシフトを自動生成（8パターン試行→最高スコア採用）
- ガントチャートで結果表示（希望休はストライプ背景で種類別に色分け）
- セルクリックで手動微調整（ドロップダウン）
- 画面下部の**条件チェックパネル**で全スタッフの制約充足状況を自動判定
- CSV出力（Shift-JIS、マネーフォワード連携用）

### 管理画面（`admin.html`）
- スタッフの追加（職種・区分・配属を同時設定）
- 編集モーダル（勤務条件・店舗優先順位の詳細設定）
- 表示順の並び替え（▲▼ボタン）
- 有効/無効の切り替え
- 月別公休数の設定（2年分一覧、変更時自動保存）
- テスト用データリセット機能

---

## データベース設計

### `staff`（スタッフ）
| カラム | 型 | 説明 |
|:--|:--|:--|
| id | uuid (PK) | 自動生成 |
| employee_no | text | 従業員番号（CSV出力用） |
| name | text | スタッフ名 |
| display_order | integer | 表示順 |
| is_active | boolean | 在籍フラグ |
| role | text | 職種（`pharmacist` / `office`） |
| staff_type | text | 区分（`special` / `employee` / `part_time` / `external`） |
| assigned_store | text | 配属（`ebisu` / `shibuya` / `both`） |
| work_conditions | jsonb | 勤務条件（下記参照） |
| store_priority | jsonb | 店舗配置優先順位（`{"ebisu": 1, "shibuya": 2}` 形式） |

#### `work_conditions` の使用キー
| キー | 型 | 使用スタッフ | 説明 |
|:--|:--|:--|:--|
| `target_days_per_month` | number | 徳永,木庭,中村,諫早 | 基本の月勤務目標日数 |
| `max_days_per_month` | number | 徳永,木庭,中村,諫早 | 不足時の上限日数 |
| `max_consecutive_days` | number | 中村,諫早,本庄 | 最大連勤日数（未設定時はデフォルト5） |
| `max_sunday_per_month` | number | 徳永 | 月の日曜出勤上限 |
| `alternating_weeks` | number[] | 中村 | 週ごとの勤務日数パターン（例: `[2, 3]`） |

### `shift_requests`（希望休）
| カラム | 型 | 説明 |
|:--|:--|:--|
| id | uuid (PK) | 自動生成 |
| staff_id | uuid (FK) | スタッフID |
| date | date | 希望日 |
| request_type | text | `off` / `dispense` / `am` / `pm` / `other` |
| note | text | 備考 |

### `shift_assignments`（シフト生成結果）
| カラム | 型 | 説明 |
|:--|:--|:--|
| id | uuid (PK) | 自動生成 |
| year_month | text | 対象月（`2026-04`形式） |
| staff_id | uuid (FK) | スタッフID |
| date | date | 日付 |
| attendance_type | text | 勤怠区分（`平日` / `所定休日` / `法定休日`） |
| work_pattern | text | 勤務パターン（`○恵比寿` / `☆渋谷` / `◯開発` 等） |
| is_manual_override | boolean | 手動調整フラグ |

### `monthly_settings`（月別公休数）
| カラム | 型 | 説明 |
|:--|:--|:--|
| year_month | text (UNIQUE) | 対象月 |
| employee_days_off | integer | 社員の公休数 |

---

## スタッフ情報

### 薬剤師
| 名前 | 区分 | 配属 | 勤務条件 |
|:--|:--|:--|:--|
| 村上正樹 | 特別枠 | 両方 | 穴埋め専用（薬剤師不足時のみ出動） |
| 信太和人 | 社員 | 渋谷専属 | 月間公休数は`monthly_settings`に従う |
| 小野夏海 | 社員 | 恵比寿専属 | 日曜定休、月間公休数は`monthly_settings`に従う |
| 徳永麻衣子 | パート | 両方 | 基本17日/不足時MAX22日、日曜月2回まで |

### 事務
| 名前 | 区分 | チーム | 勤務条件 |
|:--|:--|:--|:--|
| 木庭弥生 | パート | 恵比寿① | 基本17日/MAX22日、連勤上限5日 |
| 中村かな子 | パート | 恵比寿② | 月10日、週2/3交互、連勤上限4日 |
| 諫早千佳 | パート | 渋谷① | 基本13日/MAX17日、連勤上限4日 |
| 本庄里帆 | パート | 渋谷② | 穴埋め要員（目標なし）、連勤上限3日 |

---

## シフト生成アルゴリズム

ルールベース貪欲法（8パターン試行→最高スコア採用）で**決定論的に**自動生成。
AI/機械学習は使用しておらず、全てのルールは明示的にコード内で定義されている。
詳細な制約条件は [`docs/shift-generation-requirements.md`](docs/shift-generation-requirements.md) を参照。

### アーキテクチャ（`js/generate.js`）
```
runAllChecks()  ← 全チェック項目を実行し構造化データを返す共通エンジン
  ├── scoreShifts()          ← スコアを算出（生成時の比較用）
  └── renderConditionsCheck() ← UIパネルに結果を描画
```
- チェックロジックは `runAllChecks()` に一元化されており、スコアリングとUI表示の整合性を保証
- ヘルパー関数（`_workDays`, `_maxConsecutiveWork` 等）はモジュールレベルで共有

### 生成の流れ
1. 社員（小野・信太）の公休日を事前計算（希望休反映→日曜定休→残りを分散配置）
2. 小野・信太を各日に配置
3. 徳永をペース配分＋不足カバーロジックで配置
4. 信太の◯開発判定（月1〜2回）
5. 事務パートを優先順位（①木庭・諫早 ②中村 ③本庄）で配置
6. 村上の穴埋め判定（薬剤師不足時のみ）
7. スコアリング（ハード制約違反=大ペナルティ、ソフト制約=重み付きペナルティ/ボーナス）

### 主要な制約（概要）
- **ハード制約**: 店舗充足、希望休反映、連勤上限（個別設定）、調剤含み連勤、店舗固定、公休数、勤務日数上限
- **ソフト制約**: 信太↔小野の非重複、小野の日曜隣接2連休、信太の連休分散、事務の店舗固定とペース配分、徳永の店舗選択、村上の出勤最小化

---

## ドキュメント
| ファイル | 内容 |
|:--|:--|
| `docs/shift-generation-requirements.md` | 制約条件一覧（v4） |
| `docs/past-shift-analysis.md` | 過去シフト（2〜4月）の実態分析レポート |
| `docs/changelog.md` | シフト生成ロジックの変更ログ |

---

## ローカル開発
```bash
npx -y http-server -p 8000 -c-1
```
- メイン画面: http://localhost:8000/
- シフト生成: http://localhost:8000/generate.html
- 管理画面: http://localhost:8000/admin.html

---

## マイルストーン

| フェーズ | 状態 | 内容 |
|:--|:--|:--|
| M1: 希望休収集 | ✅ 完成 | ガントチャート＋カレンダー、ドラッグ一括登録、調剤区分対応 |
| M2-Phase1: DB拡張 | ✅ 完了 | staff拡張、shift_assignments、monthly_settings |
| M2-Phase2: 管理画面UI | ✅ 完了 | 職種・区分・配属・勤務条件の設定UI |
| M2-Phase3: 生成アルゴリズム | ✅ 完了 | ルールベース貪欲法、8パターン試行、条件チェックパネル |
| M2-Phase4: 生成画面 | ✅ 完了 | ガントチャート＋手動調整UI＋希望休ストライプ表示 |
| M2-Phase5: CSV出力 | ⏸ 保留 | マネーフォワード連携 |
| M3: ロジック精緻化 | ✅ 完了 | 連勤制限強化、調剤日数考慮、条件チェックリファクタリング |
