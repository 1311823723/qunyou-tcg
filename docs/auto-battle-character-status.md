# 自动对战角色技能进度

> 本文档由 `npm run automation:report` 生成，请修改 `data/cards/character_implementation.json` 后重新生成。

## 总览

- 角色总数：120
- 预组角色（去重）：101
- 非预组角色：19
- 自动化：未实现 72 / 实现中 0 / 已实现 48
- 设计复核：已确认 97 / 待确认 0 / 待实测 23 / 待优化 0

## 预组解锁进度

| 预组 | 流派 | 已实现 | 状态 |
| --- | --- | ---: | --- |
| 上头组 | 爆杀流 | 16/16 | 已解锁 |
| 幽幕组 | 伏击流 | 1/16 | 未解锁 |
| 逆命组 | 卖血流 | 2/16 | 未解锁 |
| 操作组 | 行动流 | 16/16 | 已解锁 |
| 不落组 | 防御流 | 1/16 | 未解锁 |
| 执棋组 | 调度流 | 6/16 | 未解锁 |
| 密裁组 | 密裁 | 16/16 | 已解锁 |
| 变通组 | 拟态流 | 7/16 | 未解锁 |

## 状态清单

### 未实现（72）

`char_017_huihuan_defect-robot` 故障机器人-灰焕、`char_018_baizi_defect-robot` 故障机器人-摆子、`char_019_dong_defect-robot` 故障机器人-dong、`char_020_baizi_ironclad` 铁甲战士-摆子、`char_021_xiaoapan_warlock` 术士-小阿潘、`char_022_weixiaokele_goblin` 埃德加-微笑尅乐、`char_023_arthur_falcon` 猎鹰-Arthur、`char_024_weixiaokele_ironclad` 罗莎-微笑尅乐、`char_025_baizi_high-priest` 大祭司-摆子、`char_026_miaosila_neo` 涅奥-喵斯拉、`char_027_weixiaokele_medium` 通灵者-微笑尅乐、`char_028_arthur_undertaker` 殡葬者-Arthur、`char_029_daidaishou_luna` 露娜-呆呆兽、`char_030_miaosila_detective` 侦探-喵斯拉、`char_031_arthur_watcher` 观者-Arthur、`char_032_weixiaokele_silent-hunter` 黑鸦-微笑尅乐、`char_033_weixiaokele_watcher` 风姬-微笑尅乐、`char_034_xiaoapan_avenger` 复仇者-小阿潘、`char_035_xiaoapan_silent-hunter` 静默猎手-小阿潘、`char_052_fengyaojing_desert-butcher` 荒漠屠夫-风妖精、`char_053_xiaoka_zaun-beast` 祖安怒兽-小卡、`char_055_xiaoapan_judge` 审判官-小阿潘、`char_071_xiangcai_lover` 恋人-香菜、`char_072_guamao_lover` 恋人-瓜猫、`char_073_xiaoapan_bee-medic` 蜂医-小阿潘、`char_074_huihuan_nameless` 无名-灰焕、`char_075_baizi_weilong` 威龙-摆子、`char_076_daidaishou_hackclaw` 骇爪-呆呆兽、`char_077_xiaoapan_shepherd` 牧羊人-小阿潘、`char_078_huihuan_deep-blue` 深蓝-灰焕、`char_079_xiaoka_visionary-painter` 异画师-小卡、`char_080_huihuan_visionary-painter` 异画师-灰焕、`char_081_aichitun_morphling` 变形鸭-爱吃豚侠、`char_082_aichitun_embalmer` 入殓师-爱吃豚侠、`char_083_aichitun_detective` 侦探-爱吃豚侠、`char_084_keke_watcher` 观者-柯柯、`char_085_aichitun_bodyguard` 保镖-爱吃豚侠、`char_086_aichitun_sheriff` 警长-爱吃豚侠、`char_087_qindi_vigilante` 正义使者-秦帝、`char_088_horus-lupercal_serial-killer` 连环杀手-荷鲁斯-卢佩卡尔、`char_089_kabishou_canadian` 加拿大鹅-柯柯、`char_090_miaosila_medium` 灵媒-喵斯拉、`char_091_zongzi_vulture` 秃鹫-粽子、`char_092_player_detective` 侦探-机器人 1 号、`char_093_tutu_snitch` 告密者-图图、`char_094_daidaishou_astral` 星界使者-呆呆兽、`char_095_pangpanghali_prophet` 预言家-胖胖哈力、`char_096_kabishou_politician` 政治家-柯柯、`char_097_horus-lupercal_bird-eater` 食鸟鸭-荷鲁斯-卢佩卡尔、`char_098_qindi_silencer` 静音-秦帝、`char_099_kabishou_invisible-duck` 隐形鸭-柯柯、`char_100_miaosila_demolitionist` 爆炸王-喵斯拉、`char_101_pangpanghali_identity-thief` 身份窃贼-胖胖哈力、`char_102_miaosila_dodo` 呆呆鸟-喵斯拉、`char_103_zongzi_snitch` 告密者-粽子、`char_104_player_falcon` 猎鹰-机器人 1 号、`char_105_tutu_professional` 专业杀手-图图、`char_106_qindi_vulture` 秃鹫-秦帝、`char_107_daidaishou_engineer` 工程师-呆呆兽、`char_108_tutu_birdwatcher` 观鸟者-图图、`char_109_qindi_bodyguard` 保镖-秦帝、`char_110_pangpanghali_canadian` 加拿大鹅-胖胖哈力、`char_111_horus-lupercal_adventurer` 冒险家-荷鲁斯-卢佩卡尔、`char_112_miaosila_locksmith` 锁匠-喵斯拉、`char_113_miaosila_celebrity` 网红-喵斯拉、`char_114_zongzi_bodyguard` 保镖-粽子、`char_115_player_mimic` 模仿鹅-机器人 1 号、`char_116_tutu_vigilante` 正义使者-图图、`char_117_daidaishou_medium` 灵媒-呆呆兽、`char_118_qindi_birdwatcher` 观鸟者-秦帝、`char_119_pangpanghali_politician` 政治家-胖胖哈力、`char_120_player_astral` 星界使者-机器人 1 号

### 实现中（0）

无

### 已实现（48）

`char_001_keke_assassin` 刺客-柯柯、`char_002_weixiaokele_assassin` 刺客-微笑尅乐、`char_003_qindi_sheriff` 警长-秦帝、`char_004_horus-lupercal_pelican` 鹈鹕-荷鲁斯-卢佩卡尔、`char_005_aichitun_jester` 小丑-爱吃豚侠、`char_006_weixiaokele_ninja` 忍者-微笑尅乐、`char_007_baizi_ninja` 忍者-摆子、`char_008_baizi_hitman` 专业杀手-摆子、`char_009_weixiaokele_hitman` 专业杀手-微笑尅乐、`char_010_weixiaokele_bomber` 爆炸王-微笑尅乐、`char_011_baizi_bomber` 爆炸王-摆子、`char_012_baizi_bird-eater` 食鸟鸭-摆子、`char_013_weixiaokele_morphling` 变形鸭-微笑尅乐、`char_014_baizi_party-duck` 派对鸭-摆子、`char_015_weixiaokele_lobbyist` 说客-微笑尅乐、`char_016_baizi_gravy` 肉汁-摆子、`char_036_keke_spy` 间谍-柯柯、`char_037_keke_seer` 预言家-柯柯、`char_038_keke_avenger` 复仇者-柯柯、`char_039_keke_judge` 审判官-柯柯、`char_040_fengyaojing_detective` 侦探-风妖精、`char_041_baizi_watcher` 观者-摆子、`char_042_xiaoapan_neo` 涅奥-小阿潘、`char_043_baizi_falcon` 猎鹰-摆子、`char_044_arthur_sheriff` 警长-Arthur、`char_045_guamao_assassin` 刺客-瓜猫、`char_046_fengyaojing_watcher` 观者-风妖精、`char_047_miaosila_ironclad` 铁甲战士-喵斯拉、`char_048_xiaoka_high-priest` 大祭司-小卡、`char_049_xiaoapan_undertaker` 殡葬者-小阿潘、`char_050_dong_bomber` 爆炸王-dong、`char_051_baizi_lobbyist` 说客-摆子、`char_054_xiangcai_prophet` 预言家-香菜、`char_056_huihuan_watcher` 观者-灰焕、`char_057_guamao_silent-hunter` 静默猎手-瓜猫、`char_058_xiangcai_politician` 政治家-香菜、`char_059_dong_justice` 正义使者-dong、`char_060_linglong_defect-robot` 故障机器人-绫珑、`char_061_xiangcai_watcher` 观者-香菜、`char_062_guamao_morphling` 变形鸭-瓜猫、`char_063_dong_assassin` 刺客-dong、`char_064_huihuan_pelican` 鹈鹕-灰焕、`char_065_dong_high-priest` 大祭司-dong、`char_066_linglong_ninja` 忍者-绫珑、`char_067_xiangcai_neo` 涅奥-香菜、`char_068_huihuan_bird-eater` 食鸟鸭-灰焕、`char_069_dong_sheriff` 警长-dong、`char_070_huihuan_silent-hunter` 静默猎手-灰焕

### 待确认（0）

无

### 待实测（23）

`char_001_keke_assassin` 刺客-柯柯、`char_003_qindi_sheriff` 警长-秦帝、`char_004_horus-lupercal_pelican` 鹈鹕-荷鲁斯-卢佩卡尔、`char_005_aichitun_jester` 小丑-爱吃豚侠、`char_009_weixiaokele_hitman` 专业杀手-微笑尅乐、`char_010_weixiaokele_bomber` 爆炸王-微笑尅乐、`char_011_baizi_bomber` 爆炸王-摆子、`char_013_weixiaokele_morphling` 变形鸭-微笑尅乐、`char_017_huihuan_defect-robot` 故障机器人-灰焕、`char_018_baizi_defect-robot` 故障机器人-摆子、`char_019_dong_defect-robot` 故障机器人-dong、`char_037_keke_seer` 预言家-柯柯、`char_039_keke_judge` 审判官-柯柯、`char_040_fengyaojing_detective` 侦探-风妖精、`char_050_dong_bomber` 爆炸王-dong、`char_054_xiangcai_prophet` 预言家-香菜、`char_056_huihuan_watcher` 观者-灰焕、`char_060_linglong_defect-robot` 故障机器人-绫珑、`char_062_guamao_morphling` 变形鸭-瓜猫、`char_065_dong_high-priest` 大祭司-dong、`char_070_huihuan_silent-hunter` 静默猎手-灰焕、`char_106_qindi_vulture` 秃鹫-秦帝、`char_114_zongzi_bodyguard` 保镖-粽子

### 待优化（0）

无

## 卡池范围

- 预组角色（去重 101 张）：在下方明细的“预组”列中标明复用关系。
- 非预组角色（19 张）：`char_021_xiaoapan_warlock` 术士-小阿潘、`char_024_weixiaokele_ironclad` 罗莎-微笑尅乐、`char_026_miaosila_neo` 涅奥-喵斯拉、`char_028_arthur_undertaker` 殡葬者-Arthur、`char_029_daidaishou_luna` 露娜-呆呆兽、`char_030_miaosila_detective` 侦探-喵斯拉、`char_031_arthur_watcher` 观者-Arthur、`char_053_xiaoka_zaun-beast` 祖安怒兽-小卡、`char_075_baizi_weilong` 威龙-摆子、`char_076_daidaishou_hackclaw` 骇爪-呆呆兽、`char_077_xiaoapan_shepherd` 牧羊人-小阿潘、`char_078_huihuan_deep-blue` 深蓝-灰焕、`char_079_xiaoka_visionary-painter` 异画师-小卡、`char_080_huihuan_visionary-painter` 异画师-灰焕、`char_099_kabishou_invisible-duck` 隐形鸭-柯柯、`char_100_miaosila_demolitionist` 爆炸王-喵斯拉、`char_102_miaosila_dodo` 呆呆鸟-喵斯拉、`char_103_zongzi_snitch` 告密者-粽子、`char_113_miaosila_celebrity` 网红-喵斯拉。


## 角色明细

| ID | 角色 | 定位 | 预组 | 自动化 | 设计复核 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| char_001_keke_assassin | 刺客-柯柯 | 伏击 | 上头组、逆命组 | 已实现 | 待实测 | 宣言花色命中率待实战验证。 |
| char_002_weixiaokele_assassin | 刺客-微笑尅乐 | 控制 | 上头组、执棋组 | 已实现 | 已确认 |  |
| char_003_qindi_sheriff | 警长-秦帝 | 强攻 | 上头组、逆命组 | 已实现 | 待实测 | 未造成伤害时的反噬频率待实战验证。 |
| char_004_horus-lupercal_pelican | 鹈鹕-荷鲁斯-卢佩卡尔 | 控制 | 上头组 | 已实现 | 待实测 | 休整2的费用强度待实战验证。 |
| char_005_aichitun_jester | 小丑-爱吃豚侠 | 强攻 | 上头组 | 已实现 | 待实测 | 弃二摸一的收益待实战验证。 |
| char_006_weixiaokele_ninja | 忍者-微笑尅乐 | 伏击 | 上头组 | 已实现 | 已确认 |  |
| char_007_baizi_ninja | 忍者-摆子 | 控制 | 上头组、执棋组 | 已实现 | 已确认 |  |
| char_008_baizi_hitman | 专业杀手-摆子 | 强攻 | 上头组 | 已实现 | 已确认 |  |
| char_009_weixiaokele_hitman | 专业杀手-微笑尅乐 | 强攻 | 上头组 | 已实现 | 待实测 | 伤害替换为休整的场面收益待实战验证。 |
| char_010_weixiaokele_bomber | 爆炸王-微笑尅乐 | 控制 | 上头组 | 已实现 | 待实测 | 炸弹的延迟节奏待实战验证。 |
| char_011_baizi_bomber | 爆炸王-摆子 | 强攻 | 上头组 | 已实现 | 待实测 | 自爆伤害上限待实战验证。 |
| char_012_baizi_bird-eater | 食鸟鸭-摆子 | 资源 | 上头组、变通组 | 已实现 | 已确认 |  |
| char_013_weixiaokele_morphling | 变形鸭-微笑尅乐 | 支援 | 上头组、变通组 | 已实现 | 待实测 | 自动结算按获得技能的变形鸭自身支付复制技能费用；复制退场自身时由变形鸭退场，交叉预组实战待验证。 |
| char_014_baizi_party-duck | 派对鸭-摆子 | 控制 | 上头组、变通组 | 已实现 | 已确认 |  |
| char_015_weixiaokele_lobbyist | 说客-微笑尅乐 | 强攻 | 上头组 | 已实现 | 已确认 |  |
| char_016_baizi_gravy | 肉汁-摆子 | 防御 | 上头组、不落组、变通组 | 已实现 | 已确认 |  |
| char_017_huihuan_defect-robot | 故障机器人-灰焕 | 防御 | 变通组 | 未实现 | 待实测 | 冰冻充能球的蓄能节奏待实战验证。 |
| char_018_baizi_defect-robot | 故障机器人-摆子 | 强攻 | 变通组 | 未实现 | 待实测 | 黑暗充能球的爆发上限待实战验证。 |
| char_019_dong_defect-robot | 故障机器人-dong | 资源 | 变通组 | 未实现 | 待实测 | 等离子充能球的降费连锁待实战验证。 |
| char_020_baizi_ironclad | 铁甲战士-摆子 | 强攻 | 逆命组、变通组 | 未实现 | 已确认 |  |
| char_021_xiaoapan_warlock | 术士-小阿潘 | 强攻 | 非预组 | 未实现 | 已确认 |  |
| char_022_weixiaokele_goblin | 埃德加-微笑尅乐 | 强攻 | 逆命组 | 未实现 | 已确认 |  |
| char_023_arthur_falcon | 猎鹰-Arthur | 防御 | 不落组、变通组 | 未实现 | 已确认 |  |
| char_024_weixiaokele_ironclad | 罗莎-微笑尅乐 | 防御 | 非预组 | 未实现 | 已确认 |  |
| char_025_baizi_high-priest | 大祭司-摆子 | 防御 | 不落组 | 未实现 | 已确认 |  |
| char_026_miaosila_neo | 涅奥-喵斯拉 | 资源 | 非预组 | 未实现 | 已确认 |  |
| char_027_weixiaokele_medium | 通灵者-微笑尅乐 | 资源 | 变通组 | 未实现 | 已确认 |  |
| char_028_arthur_undertaker | 殡葬者-Arthur | 资源 | 非预组 | 未实现 | 已确认 |  |
| char_029_daidaishou_luna | 露娜-呆呆兽 | 控制 | 非预组 | 未实现 | 已确认 |  |
| char_030_miaosila_detective | 侦探-喵斯拉 | 控制 | 非预组 | 未实现 | 已确认 |  |
| char_031_arthur_watcher | 观者-Arthur | 控制 | 非预组 | 未实现 | 已确认 |  |
| char_032_weixiaokele_silent-hunter | 黑鸦-微笑尅乐 | 支援 | 变通组 | 未实现 | 已确认 |  |
| char_033_weixiaokele_watcher | 风姬-微笑尅乐 | 支援 | 执棋组、变通组 | 未实现 | 已确认 |  |
| char_034_xiaoapan_avenger | 复仇者-小阿潘 | 伏击 | 幽幕组 | 未实现 | 已确认 |  |
| char_035_xiaoapan_silent-hunter | 静默猎手-小阿潘 | 伏击 | 幽幕组、执棋组 | 未实现 | 已确认 |  |
| char_036_keke_spy | 间谍-柯柯 | 控制 | 密裁组 | 已实现 | 已确认 |  |
| char_037_keke_seer | 预言家-柯柯 | 资源 | 密裁组、变通组 | 已实现 | 待实测 | 宣言与抵消、减伤及濒死插入结算的交互待实战验证。 |
| char_038_keke_avenger | 复仇者-柯柯 | 强攻 | 密裁组 | 已实现 | 已确认 |  |
| char_039_keke_judge | 审判官-柯柯 | 控制 | 密裁组 | 已实现 | 待实测 | 出牌、响应与濒死三种基础牌需求窗口待实战验证。 |
| char_040_fengyaojing_detective | 侦探-风妖精 | 控制 | 密裁组 | 已实现 | 待实测 | 双方私有选牌与王牌拼点顺序待实战验证。 |
| char_041_baizi_watcher | 观者-摆子 | 资源 | 密裁组 | 已实现 | 已确认 |  |
| char_042_xiaoapan_neo | 涅奥-小阿潘 | 支援 | 密裁组 | 已实现 | 已确认 |  |
| char_043_baizi_falcon | 猎鹰-摆子 | 防御 | 密裁组 | 已实现 | 已确认 |  |
| char_044_arthur_sheriff | 警长-Arthur | 控制 | 密裁组 | 已实现 | 已确认 |  |
| char_045_guamao_assassin | 刺客-瓜猫 | 伏击 | 幽幕组、密裁组 | 已实现 | 已确认 |  |
| char_046_fengyaojing_watcher | 观者-风妖精 | 资源 | 密裁组 | 已实现 | 已确认 |  |
| char_047_miaosila_ironclad | 铁甲战士-喵斯拉 | 强攻 | 执棋组、密裁组 | 已实现 | 已确认 |  |
| char_048_xiaoka_high-priest | 大祭司-小卡 | 防御 | 密裁组 | 已实现 | 已确认 |  |
| char_049_xiaoapan_undertaker | 殡葬者-小阿潘 | 资源 | 密裁组 | 已实现 | 已确认 |  |
| char_050_dong_bomber | 爆炸王-dong | 强攻 | 密裁组 | 已实现 | 待实测 | 连续弃置黑色牌的牌差上限待实战验证。 |
| char_051_baizi_lobbyist | 说客-摆子 | 支援 | 执棋组、密裁组、变通组 | 已实现 | 已确认 |  |
| char_052_fengyaojing_desert-butcher | 荒漠屠夫-风妖精 | 强攻 | 逆命组 | 未实现 | 已确认 |  |
| char_053_xiaoka_zaun-beast | 祖安怒兽-小卡 | 强攻 | 非预组 | 未实现 | 已确认 |  |
| char_054_xiangcai_prophet | 预言家-香菜 | 资源 | 操作组 | 已实现 | 待实测 | 观看5张时的牌堆控制强度待实战验证。 |
| char_055_xiaoapan_judge | 审判官-小阿潘 | 控制 | 执棋组、变通组 | 未实现 | 已确认 |  |
| char_056_huihuan_watcher | 观者-灰焕 | 资源 | 操作组 | 已实现 | 待实测 | 看3选行动牌的检索效率待实战验证。 |
| char_057_guamao_silent-hunter | 静默猎手-瓜猫 | 资源 | 操作组 | 已实现 | 已确认 |  |
| char_058_xiangcai_politician | 政治家-香菜 | 支援 | 操作组 | 已实现 | 已确认 |  |
| char_059_dong_justice | 正义使者-dong | 支援 | 操作组 | 已实现 | 已确认 |  |
| char_060_linglong_defect-robot | 故障机器人-绫珑 | 支援 | 操作组 | 已实现 | 待实测 | 闪电充能球的支援节奏待实战验证。 |
| char_061_xiangcai_watcher | 观者-香菜 | 资源 | 操作组 | 已实现 | 已确认 |  |
| char_062_guamao_morphling | 变形鸭-瓜猫 | 支援 | 操作组 | 已实现 | 待实测 | 复制行动牌的收益上限待实战验证。 |
| char_063_dong_assassin | 刺客-dong | 伏击 | 操作组 | 已实现 | 已确认 |  |
| char_064_huihuan_pelican | 鹈鹕-灰焕 | 伏击 | 操作组 | 已实现 | 已确认 |  |
| char_065_dong_high-priest | 大祭司-dong | 防御 | 操作组、执棋组 | 已实现 | 待实测 | 休整自身后的循环回复频率待实战验证。 |
| char_066_linglong_ninja | 忍者-绫珑 | 伏击 | 操作组、执棋组、变通组 | 已实现 | 已确认 |  |
| char_067_xiangcai_neo | 涅奥-香菜 | 资源 | 操作组 | 已实现 | 已确认 |  |
| char_068_huihuan_bird-eater | 食鸟鸭-灰焕 | 资源 | 操作组 | 已实现 | 已确认 |  |
| char_069_dong_sheriff | 警长-dong | 控制 | 操作组 | 已实现 | 已确认 |  |
| char_070_huihuan_silent-hunter | 静默猎手-灰焕 | 支援 | 操作组 | 已实现 | 待实测 | 指定弃置或获得牌的强度待实战验证。 |
| char_071_xiangcai_lover | 恋人-香菜 | 强攻 | 幽幕组 | 未实现 | 已确认 |  |
| char_072_guamao_lover | 恋人-瓜猫 | 控制 | 幽幕组 | 未实现 | 已确认 |  |
| char_073_xiaoapan_bee-medic | 蜂医-小阿潘 | 防御 | 逆命组 | 未实现 | 已确认 |  |
| char_074_huihuan_nameless | 无名-灰焕 | 伏击 | 幽幕组、执棋组 | 未实现 | 已确认 |  |
| char_075_baizi_weilong | 威龙-摆子 | 强攻 | 非预组 | 未实现 | 已确认 |  |
| char_076_daidaishou_hackclaw | 骇爪-呆呆兽 | 控制 | 非预组 | 未实现 | 已确认 |  |
| char_077_xiaoapan_shepherd | 牧羊人-小阿潘 | 控制 | 非预组 | 未实现 | 已确认 |  |
| char_078_huihuan_deep-blue | 深蓝-灰焕 | 控制 | 非预组 | 未实现 | 已确认 |  |
| char_079_xiaoka_visionary-painter | 异画师-小卡 | 支援 | 非预组 | 未实现 | 已确认 |  |
| char_080_huihuan_visionary-painter | 异画师-灰焕 | 支援 | 非预组 | 未实现 | 已确认 |  |
| char_081_aichitun_morphling | 变形鸭-爱吃豚侠 | 资源 | 执棋组 | 未实现 | 已确认 |  |
| char_082_aichitun_embalmer | 入殓师-爱吃豚侠 | 资源 | 执棋组 | 未实现 | 已确认 |  |
| char_083_aichitun_detective | 侦探-爱吃豚侠 | 伏击 | 执棋组 | 未实现 | 已确认 |  |
| char_084_keke_watcher | 观者-柯柯 | 支援 | 执棋组 | 未实现 | 已确认 |  |
| char_085_aichitun_bodyguard | 保镖-爱吃豚侠 | 防御 | 不落组、执棋组 | 未实现 | 已确认 |  |
| char_086_aichitun_sheriff | 警长-爱吃豚侠 | 强攻 | 执棋组 | 未实现 | 已确认 |  |
| char_087_qindi_vigilante | 正义使者-秦帝 | 强攻 | 幽幕组、逆命组、不落组 | 未实现 | 已确认 |  |
| char_088_horus-lupercal_serial-killer | 连环杀手-荷鲁斯-卢佩卡尔 | 强攻 | 逆命组 | 未实现 | 已确认 |  |
| char_089_kabishou_canadian | 加拿大鹅-柯柯 | 资源 | 幽幕组、逆命组 | 未实现 | 已确认 |  |
| char_090_miaosila_medium | 灵媒-喵斯拉 | 资源 | 逆命组 | 未实现 | 已确认 |  |
| char_091_zongzi_vulture | 秃鹫-粽子 | 资源 | 逆命组 | 未实现 | 已确认 |  |
| char_092_player_detective | 侦探-机器人 1 号 | 控制 | 逆命组 | 未实现 | 已确认 |  |
| char_093_tutu_snitch | 告密者-图图 | 控制 | 逆命组 | 未实现 | 已确认 |  |
| char_094_daidaishou_astral | 星界使者-呆呆兽 | 支援 | 逆命组 | 未实现 | 已确认 |  |
| char_095_pangpanghali_prophet | 预言家-胖胖哈力 | 支援 | 逆命组 | 未实现 | 已确认 |  |
| char_096_kabishou_politician | 政治家-柯柯 | 支援 | 逆命组 | 未实现 | 已确认 |  |
| char_097_horus-lupercal_bird-eater | 食鸟鸭-荷鲁斯-卢佩卡尔 | 伏击 | 幽幕组 | 未实现 | 已确认 |  |
| char_098_qindi_silencer | 静音-秦帝 | 伏击 | 幽幕组 | 未实现 | 已确认 |  |
| char_099_kabishou_invisible-duck | 隐形鸭-柯柯 | 伏击 | 非预组 | 未实现 | 已确认 |  |
| char_100_miaosila_demolitionist | 爆炸王-喵斯拉 | 伏击 | 非预组 | 未实现 | 已确认 |  |
| char_101_pangpanghali_identity-thief | 身份窃贼-胖胖哈力 | 伏击 | 幽幕组 | 未实现 | 已确认 |  |
| char_102_miaosila_dodo | 呆呆鸟-喵斯拉 | 伏击 | 非预组 | 未实现 | 已确认 |  |
| char_103_zongzi_snitch | 告密者-粽子 | 伏击 | 非预组 | 未实现 | 已确认 |  |
| char_104_player_falcon | 猎鹰-机器人 1 号 | 伏击 | 幽幕组 | 未实现 | 已确认 |  |
| char_105_tutu_professional | 专业杀手-图图 | 伏击 | 幽幕组 | 未实现 | 已确认 |  |
| char_106_qindi_vulture | 秃鹫-秦帝 | 伏击 | 幽幕组 | 未实现 | 待实测 | 一次获得全部弃牌的收益上限待实战验证。 |
| char_107_daidaishou_engineer | 工程师-呆呆兽 | 支援 | 幽幕组 | 未实现 | 已确认 |  |
| char_108_tutu_birdwatcher | 观鸟者-图图 | 支援 | 幽幕组 | 未实现 | 已确认 |  |
| char_109_qindi_bodyguard | 保镖-秦帝 | 防御 | 不落组 | 未实现 | 已确认 |  |
| char_110_pangpanghali_canadian | 加拿大鹅-胖胖哈力 | 防御 | 不落组 | 未实现 | 已确认 |  |
| char_111_horus-lupercal_adventurer | 冒险家-荷鲁斯-卢佩卡尔 | 防御 | 不落组 | 未实现 | 已确认 |  |
| char_112_miaosila_locksmith | 锁匠-喵斯拉 | 防御 | 不落组 | 未实现 | 已确认 |  |
| char_113_miaosila_celebrity | 网红-喵斯拉 | 防御 | 非预组 | 未实现 | 已确认 |  |
| char_114_zongzi_bodyguard | 保镖-粽子 | 防御 | 不落组 | 未实现 | 待实测 | 同等费用取消技能的交换效率待实战验证。 |
| char_115_player_mimic | 模仿鹅-机器人 1 号 | 防御 | 不落组 | 未实现 | 已确认 |  |
| char_116_tutu_vigilante | 正义使者-图图 | 防御 | 不落组 | 未实现 | 已确认 |  |
| char_117_daidaishou_medium | 灵媒-呆呆兽 | 防御 | 不落组 | 未实现 | 已确认 |  |
| char_118_qindi_birdwatcher | 观鸟者-秦帝 | 防御 | 不落组 | 未实现 | 已确认 |  |
| char_119_pangpanghali_politician | 政治家-胖胖哈力 | 支援 | 不落组 | 未实现 | 已确认 |  |
| char_120_player_astral | 星界使者-机器人 1 号 | 支援 | 不落组 | 未实现 | 已确认 |  |

