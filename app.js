try {
  const isLocalPreview = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (!isLocalPreview && window.top !== window.self) {
    window.top.location = window.self.location;
  }
} catch {
  console.warn("Frame protection was blocked by the browser sandbox.");
}

const BOARD_SIZES = [
  ["custom", "自定义"],
  ["14x14", "14x14 迷你板"],
  ["24x24", "24x24 小号板"],
  ["29x29", "29x29 标准板"],
  ["32x32", "32x32 小号板"],
  ["48x48", "48x48 标准板"],
  ["50x50", "50x50 中号板"],
  ["52x52", "52x52 常用小板"],
  ["58x58", "58x58 大号板"],
  ["64x64", "64x64 大号板"],
  ["78x78", "78x78 常用中板"],
  ["80x80", "80x80 加大板"],
  ["87x87", "87x87 超大板"],
  ["100x100", "100x100 巨型板"],
  ["104x104", "104x104 常用大板"],
  ["116x116", "116x116 超巨型板"],
  ["120x120", "120x120 极限板"],
];

const DEFAULT_GRANULARITY = 50;
const LIVE_PREVIEW_DELAY = 320;
const EXPORT_MIN_LONG_SIDE = 8192;
const DEFAULT_INVITE_CODE = "LBPD2026";
const BEAD_SIZE_CM = 0.26;
const GALLERY_STORAGE_KEY = "libai-maker-generated-gallery";
const MAX_GALLERY_ITEMS = 18;
const A4_DPI = 300;
const A4_SIZE_MM = { width: 210, height: 297 };
const EDITOR_CELL_SIZE = 30;
const EDITOR_MARGIN = 42;
const DIRECT_PATTERN_COLOR_TOLERANCE = 38;
const DIRECT_PATTERN_MIN_COLOR_COUNT = 3;
// 空白画板尺寸：填多少就是多少，不做静默改写（1 × 1 也允许）。
const BLANK_BOARD_MIN = 1;
const BLANK_BOARD_MAX = 1000;
const TFJS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
const NSFWJS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist/nsfwjs.min.js";
const SAFETY_SCRIPT_LOAD_TIMEOUT = 8000;
const SAFETY_MODEL_LOAD_TIMEOUT = 12000;
const NSFW_THRESHOLDS = {
  Porn: 0.55,
  Hentai: 0.55,
  Sexy: 0.88,
};
const LOCAL_WATERMARK_TEXT = "本图纸由用户在浏览器本地生成，内容与里白造物无关，请合规使用";
const MARD_COLOR_SOURCE_URL = "https://www.pixel-beads.com/zh/mard-bead-color-chart";
const MARD_COLOR_SOURCE_VERSION = "MARD 2026";
const MARD_EXPECTED_COLOR_COUNT = 291;
const PALETTE_SIZE_OPTIONS = [48, 64, 72, 90, 144, 221, 264, 291];
const CANVAS_FONT_STACK =
  'DottedPixel, "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif';
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/x-png",
  "image/webp",
  "image/gif",
  "image/bmp",
]);
const PIXEL_THEME_COLORS = [
  "#ff2bd6",
  "#00c8ff",
  "#39ff14",
  "#f7ff00",
  "#9b5cff",
  "#ff4a1c",
  "#38bdf8",
  "#41ffb6",
  "#ff6f91",
  "#173bff",
  "#ff8a00",
  "#a6ff00",
  "#ff007f",
  "#00ffd5",
];
const externalScriptLoads = new Map();

const BASE_PALETTE =
  "A1:250,244,200;A2:255,255,213;A3:254,255,139;A4:251,237,86;A5:244,215,56;A6:254,172,76;A7:254,139,76;A8:255,218,69;A9:255,153,91;A10:247,124,49;A11:255,221,153;A12:254,159,114;A13:255,195,101;A14:253,84,61;A15:255,243,101;A16:255,255,159;A17:255,227,110;A18:254,190,125;A19:253,124,114;A20:255,213,104;A21:255,227,149;A22:244,245,125;A23:230,201,183;A24:247,248,162;A25:255,214,125;A26:255,200,48;B1:230,238,49;B2:99,243,71;B3:158,247,128;B4:93,224,53;B5:53,227,82;B6:101,226,166;B7:61,175,128;B8:28,156,79;B9:39,82,58;B10:149,211,194;B11:93,114,42;B12:22,111,65;B13:202,235,123;B14:173,233,70;B15:46,81,50;B16:197,237,156;B17:155,177,58;B18:230,238,73;B19:36,184,140;B20:194,240,204;B21:21,106,107;B22:11,60,67;B23:48,58,33;B24:238,252,165;B25:78,132,109;B26:141,122,53;B27:204,225,175;B28:158,229,185;B29:197,226,84;B30:226,252,177;B31:176,231,146;B32:156,171,90;C1:232,255,231;C2:169,249,252;C3:160,226,251;C4:65,204,255;C5:1,172,235;C6:80,170,240;C7:54,119,210;C8:15,84,192;C9:50,75,202;C10:62,188,226;C11:40,221,222;C12:28,51,77;C13:205,232,255;C14:213,253,255;C15:34,196,198;C16:21,87,168;C17:4,209,246;C18:29,51,68;C19:24,135,162;C20:23,109,175;C21:190,221,255;C22:103,180,190;C23:200,226,255;C24:124,196,255;C25:169,229,229;C26:60,174,216;C27:211,223,250;C28:187,207,237;C29:52,72,142;D1:174,180,242;D2:133,142,221;D3:47,84,175;D4:24,42,132;D5:184,67,197;D6:172,123,222;D7:136,84,179;D8:226,211,255;D9:213,185,248;D10:54,24,81;D11:185,186,225;D12:222,154,212;D13:185,0,149;D14:139,39,155;D15:47,31,144;D16:227,225,238;D17:196,212,246;D18:164,94,199;D19:216,195,215;D20:156,50,178;D21:154,0,155;D22:51,58,149;D23:235,218,252;D24:119,134,229;D25:73,79,199;D26:223,194,248;E1:253,211,204;E2:254,192,223;E3:255,183,231;E4:232,100,158;E5:245,81,162;E6:241,61,116;E7:198,52,120;E8:255,219,233;E9:233,112,204;E10:211,55,147;E11:252,221,210;E12:247,143,195;E13:181,0,109;E14:255,209,186;E15:248,199,201;E16:255,243,235;E17:255,226,234;E18:255,199,219;E19:254,186,213;E20:216,199,209;E21:189,157,161;E22:183,133,161;E23:147,122,141;E24:225,188,232;F1:253,149,123;F2:252,61,70;F3:247,73,65;F4:252,40,60;F5:231,0,47;F6:148,54,48;F7:151,25,55;F8:188,0,40;F9:226,103,122;F10:138,69,38;F11:90,33,33;F12:253,78,106;F13:243,87,68;F14:255,169,173;F15:211,0,34;F16:254,194,166;F17:230,156,121;F18:211,124,70;F19:193,68,74;F20:205,147,145;F21:247,180,198;F22:253,192,208;F23:246,126,102;F24:230,152,170;F25:229,75,79;G1:255,226,206;G2:255,196,170;G3:244,195,165;G4:225,179,131;G5:237,176,69;G6:233,156,23;G7:157,91,62;G8:117,56,50;G9:230,180,131;G10:217,140,57;G11:224,197,147;G12:255,200,144;G13:183,113,74;G14:141,97,76;G15:252,249,224;G16:242,217,186;G17:120,82,75;G18:255,228,204;G19:224,121,53;G20:169,64,35;G21:184,133,88;H1:253,251,255;H2:254,255,255;H3:182,177,186;H4:137,133,140;H5:72,70,78;H6:47,43,47;H7:0,0,0;H8:231,214,219;H9:237,237,237;H10:238,233,234;H11:206,205,213;H12:255,245,237;H13:245,236,210;H14:207,215,211;H15:152,166,168;H16:29,20,20;H17:241,237,237;H18:255,253,240;H19:246,239,226;H20:148,159,163;H21:255,251,225;H22:202,202,212;H23:154,157,148;M1:188,198,184;M2:138,163,134;M3:105,125,128;M4:227,210,188;M5:208,204,170;M6:176,167,130;M7:180,164,151;M8:179,130,129;M9:165,135,103;M10:197,178,188;M11:159,117,148;M12:100,71,73;M13:209,144,102;M14:199,115,98;M15:117,125,120";
const EXTRA_PALETTE =
  "P1:252,247,248;P2:176,169,172;P3:175,220,171;P4:254,164,159;P5:238,140,62;P6:95,208,167;P7:235,146,112;P8:240,217,88;P9:217,217,217;P10:217,199,234;P11:243,236,201;P12:230,238,242;P13:170,203,239;P14:51,118,128;P15:102,133,117;P16:254,191,69;P17:254,163,36;P18:254,184,159;P19:255,254,236;P20:254,190,207;P21:236,190,191;P22:228,168,159;P23:165,98,104;Q1:242,165,232;Q2:233,236,145;Q3:255,255,0;Q4:255,235,250;Q5:118,206,222;R1:213,13,33;R2:249,47,131;R3:253,131,36;R4:248,236,49;R5:53,199,91;R6:35,136,145;R7:25,119,157;R8:26,96,195;R9:154,86,180;R10:255,219,76;R11:255,235,250;R12:216,213,206;R13:85,81,76;R14:159,228,223;R15:119,206,233;R16:62,207,202;R17:74,134,122;R18:127,205,157;R19:205,229,93;R20:232,199,180;R21:173,111,60;R22:108,55,47;R23:254,184,114;R24:243,193,192;R25:201,103,94;R26:210,147,190;R27:234,140,177;R28:156,135,214;T1:255,255,255;Y1:253,111,180;Y2:254,180,129;Y3:215,250,160;Y4:139,219,250;Y5:233,135,234;ZG1:218,171,179;ZG2:214,170,135;ZG3:193,189,141;ZG4:150,134,159;ZG5:132,144,166;ZG6:148,191,226;ZG7:226,169,210;ZG8:171,145,192";
const BRAND_CODE_MAP_TEXT = `
A1|A01|E02|E2|65|77
A2|A02|E01|B1|2|2
A3|A03|E05|B2|28|28
A4|A04|E07|B3|3|3
A5|A05|D03|B4|74|79
A6|A06|D05|B5|29|29
A7|A07|D08|B6|4|4
A8|A08|E08|B10|88|98
A9|A09|D06|B11|90|97
A10|A10|D07|B12|89|96
A11|A11|D01|E11|100|109
A12|A12|K09|A18|99|110
A13|A13|D04|B13|131|116
A14|A14|C05|B14|138|135
A15|A15|E04|B15|150|150
A16|A16|E03|IC04|216|216
A17|A17|E06|IC9|213|213
A18|A18|D02|IC14|223|208
A19|A19|K10|IC15|218|218
A20|A20|E09|Q6|242|242
A21|A21|E10|R07|276|261
A22|A22|E11|R06|270|255
A23|A23|E12|R08|274|259
A24|A24|E13|G3|288|273
A25|A25|E14|G4|289|274
A26|A26|E15|G5|290|275
B1|B01|F05|C1|48|48
B2|B02|F08|C2|33|33
B3|B03|F04|C7|26|26
B4|B04|F09|C3|66|78
B5|B05|F10|C4|39|39
B6|B06|G04|C9|11|11
B7|B07|G05|C10|44|44
B8|B08|F11|C5|10|10
B9|B09|F16|C6|79|84
B10|B10|G03|C11|96|100
B11|B11|F14|C12|97|99
B12|B12|F12|C13|106|111
B13|B13|F02|C14|128|119
B14|B14|F06|C15|129|117
B15|B15|F15|C16|130|122
B16|B16|F03|C17|141|133
B17|B17|F13|C18|142|141
B18|B18|F07|C19|147|147
B19|B19|G06|DH15|191|174
B20|B20|G02|DH10|192|175
B21|B21|G07|DH2|207|194
B22|B22|G08|DH7|206|193
B23|B23|F17|DH12|205|192
B24|B24|F01|IC5|222|207
B25|B25|F18|Q13|240|240
B26|B26|F19|Q7|248|248
B27|B27|F20|R10|262|262
B28|B28|F21|R11|269|254
B29|B29|F22|R09|268|253
B30|B30|F23|G6|285|270
B31|B31|F24|G7|286|271
B32|B32|F25|G12|287|272
C1|C01|G01|C8|64|76
C2|C02|H03|D1|30|30
C3|C03|H04|D2|63|75
C4|C04|H05|D3|77|82
C5|C05|H07|D7|34|34
C6|C06|H08|D4|25|25
C7|C07|H13|D8|9|9
C8|C08|H14|D9|52|71
C9|C09|H16|N5|42|42
C10|C10|H09|D25|121|130
C11|C11|H10|D28|122|113
C12|C12|H23|D26|120|120
C13|C13|H01|D30|140|142
C14|C14|H02|D29|139|136
C15|C15|H11|D31|143|132
C16|C16|H18|D32|149|149
C17|C17|H19|D36|163|156
C18|C18|H24|DH6|196|196
C19|C19|H12|DH9|202|202
C20|C20|H17|DH14|197|197
C21|C21|H06|IC3|212|212
C22|C22|H25|Q11|239|239
C23|C23|H26|R13|263|263
C24|C24|H27|R14|267|252
C25|C25|H28|R12|271|256
C26|C26|H29|R15|265|250
C27|C27|H30|G13|279|264
C28|C28|H31|G14|280|265
C29|C29|H32|G15|281|266
D1|D01|J07|D5|46|46
D2|D02|J08|D6|36|36
D3|D03|H15|D10|8|8
D4|D04|H20|D11|75|80
D5|D05|J12|D13|32|32
D6|D06|J11|D14|27|27
D7|D07|J15|D12|7|7
D8|D08|J03|D16|94|89
D9|D09|J04|D17|93|90
D10|D10|J19|D15|92|91
D11|D11|J06|D19|105|104
D12|D12|J10|D20|104|105
D13|D13|J14|D21|103|106
D14|D14|J16|D22|102|107
D15|D15|H22|D18|101|108
D16|D16|J01|D23|118|126
D17|D17|J05|D24|119|128
D18|D18|J13|D27|124|125
D19|D19|J09|D33|153|153
D20|D20|J17|D34|161|155
D21|D21|J18|D35|162|158
D22|D22|H21|DH1|198|198
D23|D23|J02|IC8|217|217
D24|D24|J20|Q14|244|244
D25|D25|J21|Q15|249|234
D26|D26|J22|R01|273|258
E1|E01|K03|E1|18|18
E2|E02|K15|A7|38|38
E3|E03|K17|A8|62|74
E4|E04|K21|A9|6|6
E5|E05|K19|A10|40|40
E6|E06|K22|A11|20|20
E7|E07|K25|A12|41|41
E8|E08|K12|A13|84|103
E9|E09|K18|A14|98|95
E10|E10|K23|A16|83|94
E11|E11|K02|A19|125|131
E12|E12|K16|A20|126|112
E13|E13|K24|A21|127|124
E14|E14|K05|E21|137|140
E15|E15|K04|A23|135|139
E16|E16|K01|IC2|221|206
E17|E17|K11|IC7|220|205
E18|E18|K13|IC13|210|210
E19|E19|K14|IC12|215|215
E20|E20|K26|Q1|241|241
E21|E21|K27|Q2|253|238
E22|E22|K28|Q4|252|237
E23|E23|K29|Q3|250|235
E24|E24|K30|G8|282|267
F1|F01|K08|A1|35|35
F2|F02|C02|A2|31|31
F3|F03|C03|A3|53|72
F4|F04|C06|A4|54|73
F5|F05|C07|A5|5|5
F6|F06|Z21|E9|16|16
F7|F07|C10|A6|47|47
F8|F08|C09|A17|81|92
F9|F09|K20|A15|82|93
F10|F10|Z20|E15|116|115
F11|F11|Z23|E16|117|129
F12|F12|C01|A22|136|134
F13|F13|C04|A24|148|148
F14|F14|K07|A25|154|154
F15|F15|C08|DH8|204|191
F16|F16|K06|IC10|211|211
F17|F17|K31|Q9|245|245
F18|F18|K32|Q10|246|246
F19|F19|K33|Q05|243|243
F20|F20|K34|R04|275|260
F21|F21|K35|R03|266|251
F22|F22|K36|R02|272|257
F23|F23|K37|R05|264|249
F24|F24|K38|G9|283|268
F25|F25|K39|G10|284|269
G1|G01|Z02|E3|76|81
G2|G02|Z05|E4|49|49
G3|G03|Z06|E5|80|85
G4|G04|Z08|E6|19|19
G5|G05|Z10|B7|43|43
G6|G06|Z11|B8|50|50
G7|G07|Z18|E7|17|17
G8|G08|Z22|E8|12|12
G9|G09|Z09|E10|91|102
G10|G10|Z15|B9|87|101
G11|G11|Z07|E12|112|118
G12|G12|Z13|E13|113|127
G13|G13|Z14|E17|115|114
G14|G14|Z17|E14|114|123
G15|G15|Z03|E19|133|143
G16|G16|Z04|E20|134|138
G17|G17|Z16|E22|144|137
G18|G18|Z01|DH5|203|203
G19|G19|Z12|DH3|208|195
G20|G20|Z19|DH13|199|199
G21|G21|Z24|Q8|247|247
H1|H01|A02|F1|15|15
H2|H02|A01|F2|1|1
H3|H03|B03|F3|13|13
H4|H04|B05|F4|78|83
H5|H05|B06|F5|45|45
H6|H06|B07|F6|51|70
H7|H07|B09|F7|14|14
H8|H08|A09|F8|85|86
H9|H09|A08|F10|95|87
H10|H10|A10|F9|86|88
H11|H11|B01|F11|123|121
H12|H12|A04|E18|132|144
H13|H13|A06|E23|145|146
H14|H14|B02|F12|146|145
H15|H15|B04|DH4|201|201
H16|H16|B08|DH11|200|200
H17|H17|A07|IC6|214|214
H18|H18|A03|IC1|219|204
H19|H19|A05|IC11|209|209
H20|H20|B10|Q12|251|236
H21|H21|A11|G1|291|276
H22|H22|A12|G2|277|277
H23|H23|B11|G11|278|278
M1|M01|Y01|YX11|168|168
M2|M02|Y02|YX12|172|172
M3|M03|Y03|YX2|166|166
M4|M04|Y04|YX15|167|167
M5|M05|Y05|YX6|174|159
M6|M06|Y06|YX1|169|169
M7|M07|Y07|YX13|171|171
M8|M08|Y08|YX14|177|162
M9|M09|Y09|YX10|170|170
M10|M10|Y10|YX9|164|164
M11|M11|Y11|YX4|176|161
M12|M12|Y12|YX5|173|173
M13|M13|Y13|YX8|175|160
M14|M14|Y14|YX3|165|165
M15|M15|Y15|YX7|178|163
P1|P01|M01|P1|71|62
P2|P02|M02|P2|55|69
P3|P03|M03|P4|73|66
P4|P04|M04|P5|72|64
P5|P05|M05|P3|56|63
P6|P06|M06|P8|157|65
P7|P07|M07|P6|159|68
P8|P08|M08|P7|158|67
P9|P09|M09|P13|195|178
P10|P10|M10|P18|187|187
P11|P11|M11|P9|185|185
P12|P12|M12|P12|190|190
P13|P13|M13|P17|193|176
P14|P14|M14|P22|183|183
P15|P15|M15|P23|184|184
P16|P16|M16|P14|182|182
P17|P17|M17|P19|179|179
P18|P18|M18|P11|194|177
P19|P19|M19|P10|186|186
P20|P20|M21|P15|188|180
P21|P21|M20|P20|180|188
P22|P22|M22|P16|189|189
P23|P23|M23|P21|181|181
Q1|Q01|W3|W3|109|W3
Q2|Q02|W4|W4|111|W4
Q3|Q03|W1|W1|107|W1
Q4|Q04|W2|W2|110|W2
Q5|Q05|W5|W5|108|W5
R1|R01|L01|T1|67|52
R2|R02|L02|N1|24|24
R3|R03|L03|N2|22|22
R4|R04|L04|N3|21|21
R5|R05|L05|N4|23|23
R6|R06|L06|T4|69|55
R7|R07|L07|T5|37|37
R8|R08|L08|T3|68|54
R9|R09|L09|T2|70|56
R10|R10|L10|L2|156|53
R11|R11|L11|T6|151|151
R12|R12|L12|T7|160|157
R13|R13|L13|-|152|152
R14|R14|S1|S1|231|231
R15|R15|S2|S2|237|224
R16|R16|S3|S3|238|225
R17|R17|S4|S5|233|233
R18|R18|S5|S4|235|222
R19|R19|S6|S11|227|227
R20|R20|S7|S6|230|230
R21|R21|S8|S13|234|221
R22|R22|S9|S15|226|226
R23|R23|S10|S12|224|219
R24|R24|S11|S4|228|228
R25|R25|S12|S14|225|220
R26|R26|S13|S9|229|229
R27|R27|S14|S8|232|232
R28|R28|S15|S10|236|223
T1|T01|L14|L6|155|51
Y1|Y01|N01|Y1|59|59
Y2|Y02|N02|Y2|60|60
Y3|Y03|N03|Y3|57|57
Y4|Y04|N04|Y4|58|58
Y5|Y05|N05|Y5|61|61
ZG1|ZG1|GB1|ZG1|254|ZG1
ZG2|ZG2|GB2|ZG2|255|ZG2
ZG3|ZG3|GB3|ZG3|256|ZG3
ZG4|ZG4|GB4|ZG4|257|ZG4
ZG5|ZG5|GB5|ZG5|258|ZG5
ZG6|ZG6|GB6|ZG6|259|ZG6
ZG7|ZG7|GB7|ZG7|260|ZG7
ZG8|ZG8|GB8|ZG8|261|ZG8
`;

const parsePalette = (value) =>
  value.split(";").map((entry) => {
    const [code, rgbText] = entry.split(":");
    const rgb = rgbText.split(",").map(Number);
    return { code, hex: rgbToHex(rgb), rgb };
  });

const BASE_COLORS = parsePalette(BASE_PALETTE);
const MARD_FULL_COLORS = [...BASE_COLORS, ...parsePalette(EXTRA_PALETTE)];
const BRAND_CODE_MAP = parseBrandCodeMap(BRAND_CODE_MAP_TEXT);
const DEFAULT_BRAND = "mard";
const DEFAULT_PALETTE_SIZE = 221;
const BRAND_PROFILES = {
  mard: {
    label: "MARD 2026",
    options: PALETTE_SIZE_OPTIONS,
    sourceUrl: MARD_COLOR_SOURCE_URL,
    sourceVersion: MARD_COLOR_SOURCE_VERSION,
  },
  coco: { label: "COCO", options: PALETTE_SIZE_OPTIONS, fallbackPrefix: "CO" },
  manman: { label: "漫漫", options: PALETTE_SIZE_OPTIONS, fallbackPrefix: "MM" },
  panpan: { label: "盼盼", options: PALETTE_SIZE_OPTIONS, fallbackPrefix: "PP" },
  mixiaowo: { label: "咪小窝", options: PALETTE_SIZE_OPTIONS, fallbackPrefix: "MX" },
};
const PALETTES = createPaletteCatalog();

// Stage 3 专业色卡引擎是可选增强。设置 localStorage
// `libms:palette-engine=off` 即可回退到原有 RGB 匹配逻辑。
const PALETTE_ENGINE_ENABLED = (() => {
  try {
    return window.localStorage.getItem("libms:palette-engine") !== "off";
  } catch {
    return true;
  }
})();
const paletteEngineCache = new Map();
let paletteEngineWarningShown = false;
const PORTRAIT_PREMIUM = Object.freeze({
  skinBrightening: 35,
  shadowCompression: 40,
  darkMergeStrength: 70,
  neutralCleanup: 65,
  redEnhancement: 40,
  outlineStrength: 75,
  blockCleanup: 80,
  detailPreservation: 70,
  gradientSmoothing: 30,
  maxColors: 30,
});

function getPaletteEngine(palette) {
  if (!PALETTE_ENGINE_ENABLED || !window.LibmsPaletteEngine?.createPaletteEngine) return null;
  const key = palette.map((color) => color.code).join("|");
  if (!paletteEngineCache.has(key)) {
    paletteEngineCache.set(
      key,
      window.LibmsPaletteEngine.createPaletteEngine(palette, {
        candidateCount: 7,
        cacheSize: 8192,
        cacheQuantization: 8,
        contextCorrectionWeight: 0.7,
      }),
    );
  }
  return paletteEngineCache.get(key);
}

function createPaletteCatalog() {
  const catalog = {};
  for (const [brand, profile] of Object.entries(BRAND_PROFILES)) {
    for (const count of profile.options) {
      catalog[getPaletteKey(brand, count)] = buildPaletteVariant(MARD_FULL_COLORS, count, brand, profile);
    }
  }
  return catalog;
}

function buildPaletteVariant(colors, count, brand, profile) {
  // 外源品牌自带官方色号（profile.colors 存在即为此类），原样保留，
  // 不参与 MARD 跨品牌换号 —— 换号会破坏 Artkal/COCO 等官方编号体系。
  const useNativeCode = Array.isArray(profile.colors);
  return colors.slice(0, count).map((color, index) => ({
    code: useNativeCode ? color.code : getBrandCode(color, brand, profile, index),
    hex: color.hex || rgbToHex(color.rgb),
    sourceCode: color.code,
    sourceHex: color.hex || rgbToHex(color.rgb),
    sourceUrl: profile.sourceUrl || "",
    sourceVersion: profile.sourceVersion || "",
    brand: profile.label,
    rgb: [...color.rgb],
  }));
}

function parseBrandCodeMap(value) {
  const map = {};
  for (const line of value.trim().split(/\n+/)) {
    const [sourceCode, mard, coco, manman, panpan, mixiaowo] = line.split("|").map((item) => item.trim());
    if (!sourceCode) continue;
    map[normalizeMardCode(sourceCode)] = { mard, coco, manman, panpan, mixiaowo };
  }
  return map;
}

function getBrandCode(color, brand, profile, index) {
  const mapping = BRAND_CODE_MAP[normalizeMardCode(color.code)];
  const mapped = mapping?.[brand];
  if (mapped) return mapped;
  if (profile.fallbackPrefix) return `${profile.fallbackPrefix}${String(index + 1).padStart(3, "0")}`;
  return color.code;
}

function normalizeMardCode(code) {
  return String(code || "").replace(/^([A-Z]+)0+(\d+)$/i, "$1$2").toUpperCase();
}

function getPaletteKey(brand, count) {
  return `${brand}-${count}`;
}

function validateMardPalette() {
  const codes = new Set(MARD_FULL_COLORS.map((color) => color.code));
  if (MARD_FULL_COLORS.length !== MARD_EXPECTED_COLOR_COUNT || codes.size !== MARD_EXPECTED_COLOR_COUNT) {
    console.error(
      `${MARD_COLOR_SOURCE_VERSION} 色表校验失败：期望 ${MARD_EXPECTED_COLOR_COUNT} 色，当前 ${MARD_FULL_COLORS.length} 色。`,
    );
  }
  const missingMappings = MARD_FULL_COLORS.filter((color) => !BRAND_CODE_MAP[normalizeMardCode(color.code)]).map(
    (color) => color.code,
  );
  if (missingMappings.length) {
    console.error(`跨品牌色号对照缺失：${missingMappings.join(", ")}`);
  }
}

// ---------- 第三方品牌色库（可选增量）----------
// 数据来自 HansBug/pindou-color-data（MIT）。异步加载；加载失败时内建 5 个品牌不受任何影响。
// 背景：内建的 mard/coco/manman/panpan/mixiaowo 共用同一份 MARD 291 色，只有色号不同，
// 所以切品牌实际颜色不变。这里新增的品牌各用自己官方色卡的**真实 RGB**，id 与内建不冲突。
const EXTERNAL_BRAND_LABELS = Object.create(null);

function registerExternalBrandPalettes(palettes, source) {
  if (!Array.isArray(palettes)) return 0;
  let added = 0;
  for (const entry of palettes) {
    const id = entry?.id;
    if (!id || BRAND_PROFILES[id]) continue; // 绝不允许覆盖内建品牌
    const colors = (entry.colors || [])
      .filter((color) => color && color.code && Array.isArray(color.rgb) && color.rgb.length >= 3)
      .map((color) => ({
        code: String(color.code),
        rgb: [...color.rgb],
        hex: color.hex || rgbToHex(color.rgb),
        group: color.group || "",
      }));
    if (!colors.length) continue;
    const count = colors.length;
    const profile = {
      label: entry.label || id,
      options: [count],
      fallbackPrefix: "",
      external: true,
      sourceId: entry.sourceId || "",
      sourceVersion: entry.sourceVersion || "",
      sourceUrl: source?.url || "",
      tierLabel: entry.tierLabel || "",
      summary: entry.summary || "",
      colors,
    };
    BRAND_PROFILES[id] = profile;
    PALETTES[getPaletteKey(id, count)] = buildPaletteVariant(colors, count, id, profile);
    EXTERNAL_BRAND_LABELS[id] = profile.label;
    added += 1;
  }
  if (!added) return 0;
  window.LibmsBrandLabels = Object.assign(Object.create(null), window.LibmsBrandLabels, EXTERNAL_BRAND_LABELS);
  appendExternalBrandButtons();
  window.dispatchEvent(
    new CustomEvent("libms:brand-palettes-ready", { detail: { added, source: source || null } }),
  );
  return added;
}

function appendExternalBrandButtons() {
  const line = document.querySelector("[data-brand]")?.parentElement;
  if (!line) return;
  for (const [id, label] of Object.entries(EXTERNAL_BRAND_LABELS)) {
    if (line.querySelector(`[data-brand="${id}"]`)) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip external-brand-chip";
    button.dataset.brand = id;
    button.setAttribute("aria-pressed", "false");
    button.textContent = label;
    button.title = BRAND_PROFILES[id]?.summary || label;
    button.addEventListener("click", () => selectBrand(id));
    line.appendChild(button);
  }
}

function loadExternalBrandPalettes() {
  import("./smart-preprocessing/palette-brands.mjs?v=20260920-brands")
    .then((module_) => {
      const added = registerExternalBrandPalettes(module_.BRAND_PALETTES, module_.BRAND_PALETTE_SOURCE);
      if (added) {
        const meta = module_.BRAND_PALETTE_SOURCE || {};
        console.info(`[palette] 已加载 ${added} 个第三方品牌色板（${meta.repo || "unknown"} / ${meta.license || ""}）`);
      }
    })
    .catch((error) => {
      console.info("[palette] 第三方品牌色板不可用（可选增量，不影响内置品牌）：", error?.message || error);
    });
}

const els = {
  visitCount: document.querySelector("#visit-count"),
  resetButton: document.querySelector("#reset-button"),
  boardSelect: document.querySelector("#board-select"),
  brandButtons: document.querySelectorAll("[data-brand]"),
  paletteSelect: document.querySelector("#palette-select"),
  tileSizeSelect: document.querySelector("#tile-size-select"),
  mirrorSelect: document.querySelector("#mirror-select"),
  printLayoutSelect: document.querySelector("#print-layout-select"),
  printMarginInput: document.querySelector("#print-margin-input"),
  paletteCount: document.querySelector("#palette-count"),
  maxColorsInput: document.querySelector("#max-colors-input"),
  generationEngineSelect: document.querySelector("#generation-engine-select"),
  generationPresetSelect: document.querySelector("#generation-preset-select"),
  generationSamplingSelect: document.querySelector("#generation-sampling-select"),
  paletteBudgetStatus: document.querySelector("#palette-budget-status"),
  maxColorPresetButtons: document.querySelectorAll("[data-max-colors]"),
  regionStrengthInput: document.querySelector("#region-strength-input"),
  regionStrengthOutput: document.querySelector("#region-strength-output"),
  detailProtectionSelect: document.querySelector("#detail-protection-select"),
  patternOptimizerEnabled: document.querySelector("#pattern-optimizer-enabled"),
  toggleOptimizedButton: document.querySelector("#toggle-optimized-button"),
  editorPaletteSelect: document.querySelector("#editor-palette-select"),
  uploadZone: document.querySelector("#upload-zone"),
  fileInput: document.querySelector("#file-input"),
  directPatternFileInput: document.querySelector("#direct-pattern-file-input"),
  sourcePreview: document.querySelector("#source-preview"),
  sourceTitle: document.querySelector("#source-title"),
  statusPill: document.querySelector("#status-pill"),
  importButton: document.querySelector("#import-button"),
  mobileImportButton: document.querySelector("#mobile-import-button"),
  mobileProcessButton: document.querySelector("#mobile-process-button"),
  mobileDownloadButton: document.querySelector("#mobile-download-button"),
  mobileStartAssemblyButton: document.querySelector("#mobile-start-assembly-button"),
  mobilePreviewDownloadButton: document.querySelector("#mobile-preview-download-button"),
  mobileChartDownloadButton: document.querySelector("#mobile-chart-download-button"),
  mobilePrintA4Button: document.querySelector("#mobile-print-a4-button"),
  fullscreenButton: document.querySelector("#fullscreen-button"),
  registerOpenButton: document.querySelector("#register-open-button"),
  registerOpenButtonSide: document.querySelector("#register-open-button-side"),
  registerModal: document.querySelector("#register-modal"),
  registerForm: document.querySelector("#register-form"),
  registerName: document.querySelector("#register-name"),
  inviteCode: document.querySelector("#invite-code"),
  inviteStatus: document.querySelector("#invite-status"),
  registerMessage: document.querySelector("#register-message"),
  smartPhotoButton: document.querySelector("#smart-photo-button"),
  smartRestoreButton: document.querySelector("#smart-restore-button"),
  smartDirectButton: document.querySelector("#smart-direct-button"),
  smartOcrButton: document.querySelector("#smart-ocr-button"),
  smartLinkButton: document.querySelector("#smart-link-button"),
  tutorialButton: document.querySelector("#tutorial-button"),
  linkImportModal: document.querySelector("#link-import-modal"),
  linkImportForm: document.querySelector("#link-import-form"),
  linkImportUrl: document.querySelector("#link-import-url"),
  linkImportMessage: document.querySelector("#link-import-message"),
  directPatternModal: document.querySelector("#direct-pattern-modal"),
  directPatternForm: document.querySelector("#direct-pattern-form"),
  directPatternWidth: document.querySelector("#direct-pattern-width"),
  directPatternHeight: document.querySelector("#direct-pattern-height"),
  directPatternMessage: document.querySelector("#direct-pattern-message"),
  assemblyModal: document.querySelector("#assembly-modal"),
  assemblyProgressLabel: document.querySelector("#assembly-progress-label"),
  assemblySummary: document.querySelector("#assembly-summary"),
  assemblyColorList: document.querySelector("#assembly-color-list"),
  assemblyBoard: document.querySelector("#pixel-board-container"),
  assemblyClearFocusButton: document.querySelector("#assembly-clear-focus-button"),
  assemblyResetProgressButton: document.querySelector("#assembly-reset-progress-button"),
  exitModal: document.querySelector("#exit-modal"),
  exitConfirmButton: document.querySelector("#btn-confirm-exit"),
  exitCancelButton: document.querySelector("#btn-cancel-exit"),
  donateModal: document.querySelector("#donate-modal"),
  donateOpenButton: document.querySelector("#btn-open-donate"),
  donateCloseButton: document.querySelector("#btn-close-donate"),
  donateQrcode: document.querySelector("#donate-qrcode"),
  downloadButtonTop: document.querySelector("#download-button-top"),
  blankBoardButton: document.querySelector("#blank-board-button"),
  granularityInput: document.querySelector("#granularity-input"),
  granularityOutput: document.querySelector("#granularity-output"),
  granularityNumber: document.querySelector("#granularity-number"),
  granularityApply: document.querySelector("#granularity-apply"),
  mobileGranularityInput: document.querySelector("#mobile-granularity-input"),
  mobileGranularityOutput: document.querySelector("#mobile-granularity-output"),
  similarityInput: document.querySelector("#similarity-input"),
  similarityOutput: document.querySelector("#similarity-output"),
  similarityNumber: document.querySelector("#similarity-number"),
  similarityApply: document.querySelector("#similarity-apply"),
  modeSelect: document.querySelector("#mode-select"),
  backgroundModeSelect: document.querySelector("#background-mode-select"),
  processButton: document.querySelector("#process-button"),
  previewStage: document.querySelector("#preview-stage"),
  previewDownloadButton: document.querySelector("#preview-download-button"),
  emptyResult: document.querySelector("#empty-result"),
  resultPreview: document.querySelector("#result-preview"),
  resultMetrics: document.querySelector("#result-metrics"),
  schemeNameInput: document.querySelector("#scheme-name-input"),
  statsTotalLabel: document.querySelector("#stats-total-label"),
  statsSummary: document.querySelector("#stats-summary"),
  statsList: document.querySelector("#stats-list"),
  editButton: document.querySelector("#edit-button"),
  mainPatternAdjustButton: document.querySelector("#main-pattern-adjust-button"),
  startAssemblyButton: document.querySelector("#start-assembly-button"),
  startAssemblyPanelButton: document.querySelector("#start-assembly-panel-button"),
  downloadButton: document.querySelector("#download-button"),
  printA4Button: document.querySelector("#print-a4-button"),
  previewModal: document.querySelector("#preview-modal"),
  previewViewport: document.querySelector(".preview-viewport"),
  modalPreviewImage: document.querySelector("#modal-preview-image"),
  previewZoomOut: document.querySelector("#preview-zoom-out"),
  previewZoomReset: document.querySelector("#preview-zoom-reset"),
  previewZoomIn: document.querySelector("#preview-zoom-in"),
  editorModal: document.querySelector("#editor-modal"),
  editorTitle: document.querySelector("#editor-title"),
  editorMoreToolsButton: document.querySelector("#editor-more-tools-button"),
  editorToolsCollapse: document.querySelector("#editor-tools-collapse"),
  editorCanvas: document.querySelector("#editor-canvas"),
  editorZoomOut: document.querySelector("#editor-zoom-out"),
  editorZoomReset: document.querySelector("#editor-zoom-reset"),
  editorZoomIn: document.querySelector("#editor-zoom-in"),
  editorZoomLabel: document.querySelector("#editor-zoom-label"),
  currentSelection: document.querySelector("#current-selection"),
  currentSwatch: document.querySelector("#current-swatch"),
  clearColorButton: document.querySelector("#clear-color-button"),
  undoPaintButton: document.querySelector("#undo-paint-button"),
  replaceFrom: document.querySelector("#replace-from"),
  replaceTo: document.querySelector("#replace-to"),
  replaceButton: document.querySelector("#replace-button"),
  undoReplaceButton: document.querySelector("#undo-replace-button"),
  fillSelectionButton: document.querySelector("#fill-selection-button"),
  clearSelectionButton: document.querySelector("#clear-selection-button"),
  paletteGroups: document.querySelector("#palette-groups"),
  editorToolButtons: document.querySelectorAll("[data-editor-tool]"),
  floatingTools: document.querySelector("#floating-tools"),
  floatingTitle: document.querySelector("#floating-title"),
  applyFloatingButton: document.querySelector("#apply-floating-button"),
  cancelFloatingButton: document.querySelector("#cancel-floating-button"),
  moreToolsPanel: document.querySelector("#more-tools-panel"),
  toggleEditorGrid: document.querySelector("#toggle-editor-grid"),
  toggleEditorCodes: document.querySelector("#toggle-editor-codes"),
  toggleEditorCoords: document.querySelector("#toggle-editor-coords"),
  toggleEditorSnap: document.querySelector("#toggle-editor-snap"),
  editorToolbarPosition: document.querySelector("#editor-toolbar-position"),
  flipHorizontalButton: document.querySelector("#flip-horizontal-button"),
  flipVerticalButton: document.querySelector("#flip-vertical-button"),
  scaleDownButton: document.querySelector("#scale-down-button"),
  scaleUpButton: document.querySelector("#scale-up-button"),
  referenceImageInput: document.querySelector("#reference-image-input"),
  referenceImageButton: document.querySelector("#reference-image-button"),
  clearReferenceButton: document.querySelector("#clear-reference-button"),
  referenceControls: document.querySelector("#reference-controls"),
  referenceOpacity: document.querySelector("#reference-opacity"),
  referenceOpacityOutput: document.querySelector("#reference-opacity-output"),
  referenceScale: document.querySelector("#reference-scale"),
  referenceScaleOutput: document.querySelector("#reference-scale-output"),
  referenceRotation: document.querySelector("#reference-rotation"),
  referenceRotationOutput: document.querySelector("#reference-rotation-output"),
  referenceVisibleButton: document.querySelector("#reference-visible-button"),
  referenceLockButton: document.querySelector("#reference-lock-button"),
  referenceNudgeButtons: document.querySelectorAll("[data-reference-nudge]"),
  patternAdjustButton: document.querySelector("#pattern-adjust-button"),
  gridAlignButton: document.querySelector("#grid-align-button"),
  libraryImportSelect: document.querySelector("#library-import-select"),
  importLibraryButton: document.querySelector("#import-library-button"),
  trimArtworkButton: document.querySelector("#trim-artwork-button"),
  fitEditorButton: document.querySelector("#fit-editor-button"),
  clearArtworkButton: document.querySelector("#clear-artwork-button"),
  artworkNameInput: document.querySelector("#artwork-name-input"),
  assemblyModeButton: document.querySelector("#assembly-mode-button"),
  saveLibraryButton: document.querySelector("#save-library-button"),
  downloadEditorButton: document.querySelector("#download-editor-button"),
  publishCommunityButton: document.querySelector("#publish-community-button"),
  cancelEditButton: document.querySelector("#cancel-edit-button"),
  saveEditButton: document.querySelector("#save-edit-button"),
  generatedGallery: document.querySelector("#generated-gallery"),
  gallerySearch: document.querySelector("#gallery-search"),
  galleryCount: document.querySelector("#gallery-count"),
  galleryEmpty: document.querySelector("#gallery-empty"),
  galleryClearButton: document.querySelector("#gallery-clear-button"),
  blankBoardModal: document.querySelector("#blank-board-modal"),
  blankBoardWidth: document.querySelector("#blank-board-width"),
  blankBoardHeight: document.querySelector("#blank-board-height"),
  blankBoardSummary: document.querySelector("#blank-board-summary"),
  blankBoardMessage: document.querySelector("#blank-board-message"),
  blankBoardPresets: document.querySelectorAll("[data-size]"),
  createBlankBoardButton: document.querySelector("#create-blank-board-button"),
  patternAdjustModal: document.querySelector("#pattern-adjust-modal"),
  patternAdjustPreviewImage: document.querySelector("#pattern-adjust-preview-image"),
  patternAdjustInputs: document.querySelectorAll("[data-pattern-adjust]"),
  resetPatternAdjustButton: document.querySelector("#reset-pattern-adjust-button"),
  applyPatternAdjustButton: document.querySelector("#apply-pattern-adjust-button"),
  gridAlignModal: document.querySelector("#grid-align-modal"),
  gridOffsetX: document.querySelector("#grid-offset-x"),
  gridOffsetY: document.querySelector("#grid-offset-y"),
  gridCellWidth: document.querySelector("#grid-cell-width"),
  gridCellHeight: document.querySelector("#grid-cell-height"),
  gridAlignMessage: document.querySelector("#grid-align-message"),
  autoAlignGridButton: document.querySelector("#auto-align-grid-button"),
  applyGridAlignButton: document.querySelector("#apply-grid-align-button"),
};

const state = {
  sourceDataUrl: "",
  sourceName: "",
  sourceNaturalWidth: 0,
  sourceNaturalHeight: 0,
  grid: [],
  stats: [],
  generationEngine: "v2.5",
  generationPreset: "auto",
  generationSampling: "auto",
  generationEngineLast: "",
  // 算法引擎：与 generationEngine（v2.5 / legacy）正交的第二条轴。
  // "current" = 现有 libms 链路，一行未改；"bgs" = src/algorithms/bgs；
  // "pindou-workbench" / "hybrid-pw" = src/algorithms/pindou-workbench。
  // 默认 "current"，所以不选新引擎时全站行为与以前逐位一致。
  algorithmEngine: "current",
  algorithmEngineLast: "",
  pindoReport: null,
  bgsReport: null,
  // Batch F：pw 两个引擎的报告与档位。没跑过就是 null，不参与任何计算。
  pwReport: null,
  pwPaletteMatchMode: "ciede2000",
  pwOptions: null,
  pwHybridOptions: null,
  chartUrl: "",
  previewUrl: "",
  paletteLabel: "",
  width: 0,
  height: 0,
  previewZoom: 1,
  previewRenderCell: 8,
  previewDetailCodesVisible: false,
  previewModalUsesCurrentGrid: false,
  editorZoom: 1,
  selectedBrand: DEFAULT_BRAND,
  selectedColor: null,
  editorGrid: [],
  editorTool: "pencil",
  editorFloating: null,
  editorSelection: null,
  activeEditorSelection: null,
  editorReferenceImage: null,
  editorReference: null,
  referenceUndo: [],
  currentPaintAction: [],
  patternAdjustBase: null,
  patternAdjustPreviewGrid: null,
  patternAdjustTarget: "editor",
  patternAdjustFrame: 0,
  gridAlignBase: null,
  generationOriginalGrid: null,
  generationOptimizedGrid: null,
  showingOptimizedGrid: true,
  optimizerReport: null,
  structuralTransitionReport: null,
  structuralDetectionBaseline: null,
  regionalBlockReport: null,
  paletteBudget: null,
  editorPrefs: {
    showGrid: true,
    showCodes: true,
    showCoords: true,
    snap: true,
    toolbarPosition: "left",
  },
  assemblyMode: false,
  assemblyHighlightCode: "",
  playActiveCode: "",
  currentSelectedColor: null,
  playCompletedBeads: new Set(),
  playStorageKey: "",
  playHoverRow: "",
  playHoverCol: "",
  assemblyHistoryActive: false,
  assemblyHideCellText: false,
  directPatternFile: null,
  paintUndo: [],
  replaceUndo: [],
  manualEdited: false,
  importApproved: false,
  targetHeight: 50,
  aspectRatioLocked: false,
  isPainting: false,
  lastPaintKey: "",
  importMode: "photo",
  autoProcessAfterLoad: false,
  restoreAutoSizePending: false,
  livePreviewTimer: 0,
  livePreviewPending: false,
  isProcessingImage: false,
  backgroundDecision: "",
  paletteEngine: null,
  sourceSafetyChecked: false,
  processedSourceDataUrl: "",
  sourceTransform: { crop: null, cropRatio: "free", rotation: 0, flipX: false, flipY: false,
    brightness: 0, contrast: 0, saturation: 0, sharpen: 0,
    expand: { top: 0, bottom: 0, left: 0, right: 0 }, background: "#ffffff" },
  safetyModel: null,
  safetyModelLoading: null,
  safetyModelUnavailable: false,
};

function applyRandomPixelTheme() {
  const background = pickRandom(PIXEL_THEME_COLORS);
  const accentCandidates = PIXEL_THEME_COLORS.filter(
    (color) => color !== background && colorDistance(color, background) > 150,
  );
  const accent = pickRandom(accentCandidates.length ? accentCandidates : PIXEL_THEME_COLORS);
  const secondAccentCandidates = PIXEL_THEME_COLORS.filter(
    (color) => color !== background && color !== accent && colorDistance(color, accent) > 120,
  );
  const accent2 = pickRandom(secondAccentCandidates.length ? secondAccentCandidates : PIXEL_THEME_COLORS);
  const hot = pickRandom(["#f7ff00", "#ff8a00", "#ff2bd6", "#00ffd5"]);
  const root = document.documentElement;
  root.style.setProperty("--pixel-bg-pop", background);
  root.style.setProperty("--pixel-accent", accent);
  root.style.setProperty("--pixel-accent-2", accent2);
  root.style.setProperty("--pixel-hot", hot);
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function colorDistance(a, b) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToHex(rgbValue) {
  return `#${rgbValue
    .map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function init() {
  setupProfessionalMainLayout();
  setupProfessionalEditorLayout();
  validateMardPalette();
  loadExternalBrandPalettes();
  preloadPixelFont();
  if (els.boardSelect) {
    BOARD_SIZES.forEach(([value, label]) => {
      els.boardSelect.append(new Option(label, value));
    });
    els.boardSelect.value = "custom";
  }
  syncRangeControls("granularity", DEFAULT_GRANULARITY, 10, 500);
  syncRangeControls("similarity", 30, 0, 100);
  updatePaletteOptions();
  updateEditorPaletteOptions();
  updatePaletteCount();
  updateMaxColorPresetUi();
  updateVisitCount();
  updateInviteUi();
  renderGeneratedGallery();
  renderEditorLibraryOptions();
  bindEvents();
  updateResultUi();
  import("./ui/workspace.js?v=20260918-pindo1").then(({ mountWorkspace }) => mountWorkspace(window.LibmsWorkspaceBridge)).catch((error) => console.error("Workspace UI mount failed", error));
}

function setupProfessionalMainLayout() {
  const wrap = document.querySelector(".workspace-wrap");
  const grid = wrap?.querySelector(".workspace-grid");
  const studio = grid?.querySelector(".studio-main");
  const preview = studio?.querySelector(".preview-column");
  const settings = studio?.querySelector(".settings-grid");
  const intro = studio?.querySelector(".generator-intro");
  const smartTools = studio?.querySelector(".smart-tools-panel");
  const stats = preview?.querySelector(".preview-stats-panel");
  if (!wrap || !grid || !studio || !preview || !settings || grid.dataset.layoutReady) return;
  grid.dataset.layoutReady = "true";

  const topTools = document.createElement("nav");
  topTools.className = "main-global-toolbar";
  topTools.setAttribute("aria-label", "全局操作");
  const title = document.createElement("strong");
  title.textContent = "当前作品";
  const unsaved = document.createElement("small");
  unsaved.textContent = "本地编辑";
  topTools.append(title, unsaved);
  [els.tutorialButton, els.smartPhotoButton, els.blankBoardButton, els.downloadButton, els.startAssemblyButton]
    .filter(Boolean).forEach((button) => topTools.append(button));
  wrap.prepend(topTools);

  const left = document.createElement("aside");
  left.className = "main-left-toolbar";
  left.setAttribute("aria-label", "快捷工具");
  [els.editButton, els.mainPatternAdjustButton, els.smartRestoreButton, els.smartDirectButton, els.smartLinkButton]
    .filter(Boolean).forEach((button) => left.append(button));

  const center = document.createElement("section");
  center.className = "main-center-workspace";
  const tabs = document.createElement("nav");
  tabs.className = "main-view-tabs";
  tabs.innerHTML = '<button type="button" data-main-view="focus">专注模式</button><button type="button" data-main-view="source">原图</button><button class="active" type="button" data-main-view="pattern">拼豆图</button><button type="button" data-main-view="codes">色号</button>';
  center.append(tabs, preview);
  const uploadZone = intro.querySelector("#upload-zone");
  preview.querySelector(".workspace-stage")?.append(uploadZone);
  intro.remove();

  const right = document.createElement("aside");
  right.className = "main-right-inspector";
  const rightTitle = document.createElement("div");
  rightTitle.className = "main-inspector-title";
  rightTitle.innerHTML = "<strong>图纸设置</strong><small>当前参数与色卡</small>";
  right.append(rightTitle);
  [...settings.children].forEach((panel) => right.append(panel));
  if (stats) right.append(stats);
  const invite = grid.querySelector(".side-panel");
  if (invite) right.append(invite);
  if (smartTools) smartTools.remove();

  [...studio.children].filter((node) => node.matches?.("input, select[hidden]")).forEach((node) => center.prepend(node));
  grid.replaceChildren(left, center, right);

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-main-view]");
    if (!button) return;
    tabs.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    const view = button.dataset.mainView;
    grid.classList.toggle("focus-view", view === "focus");
    uploadZone.classList.toggle("source-view", view === "source");
    uploadZone.style.setProperty("display", view === "source" || !state.grid.length ? "grid" : "none", "important");
    preview.classList.toggle("source-hidden", view === "source");
    if (view === "codes" && state.grid.length) openPreview();
  });
}

function setupProfessionalEditorLayout() {
  const body = document.querySelector("#editor-modal .editor-body");
  const sidebar = body?.querySelector(".editor-sidebar");
  const canvasWrap = body?.querySelector(".editor-canvas-wrap");
  const toolDock = sidebar?.querySelector("#editor-tool-dock");
  if (!body || !sidebar || !canvasWrap || !toolDock || body.dataset.layoutReady) return;
  body.dataset.layoutReady = "true";

  const left = document.createElement("aside");
  left.className = "editor-left-toolbar";
  left.setAttribute("aria-label", "编辑工具栏");
  left.append(toolDock);
  [
    els.clearColorButton,
    document.querySelector("#reference-image-button"),
    els.patternAdjustButton,
    document.querySelector("#grid-align-button"),
  ].filter(Boolean).forEach((button) => {
    button.classList.add("left-tool-action");
    left.append(button);
  });

  const center = document.createElement("section");
  center.className = "editor-center-workspace";
  const tabs = document.createElement("nav");
  tabs.className = "editor-view-tabs";
  tabs.setAttribute("aria-label", "画布视图");
  tabs.innerHTML = [
    ["focus", "专注模式"], ["pattern", "拼豆图"], ["preview", "成品预览"], ["codes", "色号"],
  ].map(([view, label]) => `<button type="button" data-editor-view="${view}" class="${view === "codes" ? "active" : ""}">${label}</button>`).join("");

  const bottom = document.createElement("div");
  bottom.className = "editor-canvas-toolbar";
  bottom.setAttribute("aria-label", "画布快捷操作");
  const movable = [
    els.undoPaintButton,
    els.undoReplaceButton,
    document.querySelector("#flip-horizontal-button"),
    document.querySelector("#flip-vertical-button"),
    document.querySelector("#trim-artwork-button"),
    document.querySelector("#fit-editor-button"),
    document.querySelector("#toggle-editor-grid")?.closest("label"),
    document.querySelector("#toggle-editor-codes")?.closest("label"),
    document.querySelector("#toggle-editor-coords")?.closest("label"),
  ].filter(Boolean);
  movable.forEach((node) => bottom.append(node));

  center.append(tabs, canvasWrap, bottom);
  sidebar.classList.add("editor-inspector");
  const inspectorTitle = document.createElement("div");
  inspectorTitle.className = "editor-inspector-title";
  inspectorTitle.innerHTML = "<strong>图纸设置与调色板</strong><small>当前作品</small>";
  sidebar.prepend(inspectorTitle);
  body.replaceChildren(left, center, sidebar);
  const projectToolbar = document.querySelector("#editor-modal > .modal-foot");
  if (projectToolbar) {
    projectToolbar.classList.add("editor-global-toolbar");
    body.before(projectToolbar);
  }

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-editor-view]");
    if (!button) return;
    const view = button.dataset.editorView;
    tabs.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    if (view === "focus") {
      body.classList.toggle("focus-view");
      return;
    }
    body.classList.remove("focus-view");
    const showGrid = view !== "preview";
    const showCodes = view === "codes";
    state.editorPrefs.showGrid = showGrid;
    state.editorPrefs.showCodes = showCodes;
    if (els.toggleEditorGrid) els.toggleEditorGrid.checked = showGrid;
    if (els.toggleEditorCodes) els.toggleEditorCodes.checked = showCodes;
    renderEditorCanvas();
  });
}

function preloadPixelFont() {
  if (!document.fonts?.load) return;
  document.fonts.load(`16px ${CANVAS_FONT_STACK}`).then(() => {
    if (state.grid.length) {
      refreshChartUrl();
      updateResultUi();
    }
    if (els.editorModal?.open) renderEditorCanvas();
  });
}

function bindEvents() {
  els.resetButton?.addEventListener("click", resetAll);
  els.importButton?.addEventListener("click", startManualImport);
  els.mobileImportButton?.addEventListener("click", startManualImport);
  els.mobileProcessButton?.addEventListener("click", processImage);
  els.mobileDownloadButton?.addEventListener("click", downloadPattern);
  els.mobileStartAssemblyButton?.addEventListener("click", openAssemblyPlayer);
  els.mobilePreviewDownloadButton?.addEventListener("click", downloadPreviewImage);
  els.mobileChartDownloadButton?.addEventListener("click", downloadPattern);
  els.mobilePrintA4Button?.addEventListener("click", downloadA4PrintPattern);
  els.fullscreenButton?.addEventListener("click", toggleFullscreen);
  els.registerOpenButton?.addEventListener("click", openRegisterModal);
  els.registerOpenButtonSide?.addEventListener("click", openRegisterModal);
  els.registerForm?.addEventListener("submit", registerWithInvite);
  els.smartPhotoButton?.addEventListener("click", startPhotoImport);
  els.smartRestoreButton?.addEventListener("click", startRestoreImport);
  els.smartDirectButton?.addEventListener("click", startDirectPatternImport);
  els.smartOcrButton?.addEventListener("click", startOcrImport);
  els.smartLinkButton?.addEventListener("click", openLinkImportModal);
  els.tutorialButton?.addEventListener("click", showTutorialHint);
  els.linkImportForm?.addEventListener("submit", importImageFromLink);
  els.directPatternFileInput?.addEventListener("change", handleDirectPatternFileChange);
  els.directPatternForm?.addEventListener("submit", handleDirectPatternSubmit);
  els.gallerySearch?.addEventListener("input", renderGeneratedGallery);
  els.galleryClearButton?.addEventListener("click", clearGeneratedGallery);
  els.downloadButtonTop?.addEventListener("click", downloadPattern);
  els.blankBoardButton?.addEventListener("click", openBlankBoardDialog);
  els.blankBoardPresets.forEach((button) => button.addEventListener("click", () => {
    const [width, height] = String(button.dataset.size || "52,52").split(",").map(Number);
    els.blankBoardWidth.value = String(width);
    els.blankBoardHeight.value = String(height);
    updateBlankBoardSummary();
  }));
  els.blankBoardWidth?.addEventListener("input", updateBlankBoardSummary);
  els.blankBoardHeight?.addEventListener("input", updateBlankBoardSummary);
  els.createBlankBoardButton?.addEventListener("click", () => createBlankBoard({
    width: els.blankBoardWidth.value,
    height: els.blankBoardHeight.value,
  }));
  els.maxColorsInput?.addEventListener("change", () => {
    updateMaxColorPresetUi();
    scheduleLivePreview("颜色数量已更新");
  });
  els.maxColorPresetButtons.forEach((button) => button.addEventListener("click", () => {
    els.maxColorsInput.value = String(button.dataset.maxColors || 0);
    updateMaxColorPresetUi();
    scheduleLivePreview(button.dataset.maxColors === "30" ? "人物配色已限制为 30 色" : "颜色数量已更新");
  }));
  els.regionStrengthInput?.addEventListener("input", () => {
    if (els.regionStrengthOutput) els.regionStrengthOutput.value = els.regionStrengthInput.value;
    scheduleLivePreview("规整度已更新");
  });
  els.detailProtectionSelect?.addEventListener("change", () => scheduleLivePreview("细节保护已更新"));
  els.patternOptimizerEnabled?.addEventListener("change", () => scheduleLivePreview("净化设置已更新"));
  els.toggleOptimizedButton?.addEventListener("click", toggleGeneratedOptimization);
  els.brandButtons.forEach((button) => {
    button.addEventListener("click", () => selectBrand(button.dataset.brand || DEFAULT_BRAND));
  });
  bindRangePair("granularity", 10, 500);
  els.mobileGranularityInput?.addEventListener("input", () => {
    syncRangeControls("granularity", els.mobileGranularityInput.value, 10, 500);
    scheduleLivePreview("宽度已更新");
  });
  bindRangePair("similarity", 0, 100);
  els.paletteSelect.addEventListener("change", () => {
    updatePaletteCount();
    updateEditorPaletteOptions();
    updateResultUi();
    scheduleLivePreview("色板已更新");
  });
  els.backgroundModeSelect?.addEventListener("change", () => {
    scheduleLivePreview("背景处理已更新");
  });
  els.modeSelect?.addEventListener("change", () => {
    scheduleLivePreview("处理模式已更新");
  });
  els.tileSizeSelect?.addEventListener("change", updateResultUi);
  els.mirrorSelect?.addEventListener("change", updateResultUi);
  els.printLayoutSelect?.addEventListener("change", updateResultUi);
  els.printMarginInput?.addEventListener("change", updateResultUi);
  els.fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) {
      loadFile(file);
      event.target.value = "";
      return;
    }
    state.autoProcessAfterLoad = false;
    state.restoreAutoSizePending = false;
  });
  els.fileInput.addEventListener("cancel", () => { state.importApproved = false; });

  ["dragenter", "dragover"].forEach((name) => {
    els.uploadZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.uploadZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    els.uploadZone.addEventListener(name, () => {
      els.uploadZone.classList.remove("drag-over");
    });
  });

  els.uploadZone.addEventListener("drop", (event) => {
    event.preventDefault();
    state.importMode = "photo";
    state.autoProcessAfterLoad = true;
    state.restoreAutoSizePending = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });
  els.uploadZone.addEventListener("click", (event) => {
    event.preventDefault();
    state.importMode = "photo";
    state.autoProcessAfterLoad = true;
    state.restoreAutoSizePending = false;
    els.fileInput.value = "";
    els.fileInput.click();
  });
  els.uploadZone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    state.importMode = "photo";
    state.autoProcessAfterLoad = true;
    state.restoreAutoSizePending = false;
    els.fileInput.click();
  });

  els.processButton.addEventListener("click", processImage);
  els.previewStage.addEventListener("click", openPreview);
  els.previewDownloadButton?.addEventListener("click", downloadPreviewImage);
  enableMiddleButtonPan(els.previewStage);
  enableMiddleButtonPan(els.previewViewport);
  enableMiddleButtonPan(document.querySelector("#editor-modal .editor-canvas-wrap"));
  els.downloadButton.addEventListener("click", downloadPattern);
  els.printA4Button?.addEventListener("click", downloadA4PrintPattern);
  els.editButton.addEventListener("click", openEditor);
  els.mainPatternAdjustButton?.addEventListener("click", () => {
    if (!state.grid.length) return;
    openPatternAdjustDialog("main");
  });
  els.startAssemblyButton?.addEventListener("click", openAssemblyPlayer);
  els.startAssemblyPanelButton?.addEventListener("click", openAssemblyPlayer);
  els.assemblyBoard?.addEventListener("click", handleAssemblyBoardClick);
  els.assemblyBoard?.addEventListener("pointerover", handleAssemblyBoardPointerOver);
  els.assemblyBoard?.addEventListener("pointerleave", clearAssemblyCrosshair);
  els.assemblyClearFocusButton?.addEventListener("click", () => selectAssemblyColor(""));
  els.assemblyResetProgressButton?.addEventListener("click", resetAssemblyProgress);
  els.exitConfirmButton?.addEventListener("click", confirmAssemblyExit);
  els.exitCancelButton?.addEventListener("click", hideExitModal);
  els.exitModal?.addEventListener("click", (event) => {
    if (event.target === els.exitModal) hideExitModal();
  });
  els.exitModal?.addEventListener("close", () => {
    els.exitModal.setAttribute("aria-hidden", "true");
  });
  els.donateOpenButton?.addEventListener("click", openDonateModal);
  els.donateCloseButton?.addEventListener("click", closeDonateModal);
  els.donateModal?.addEventListener("click", (event) => {
    if (event.target === els.donateModal) closeDonateModal();
  });
  els.donateQrcode?.addEventListener("load", () => {
    els.donateQrcode.closest(".qrcode-container")?.classList.add("has-qrcode");
  });
  els.donateQrcode?.addEventListener("error", () => {
    els.donateQrcode.closest(".qrcode-container")?.classList.add("is-missing");
  });
  window.addEventListener("popstate", handleAssemblyPopState);

  els.previewZoomOut.addEventListener("click", () => setPreviewZoom(state.previewZoom - 0.2));
  els.previewZoomIn.addEventListener("click", () => setPreviewZoom(state.previewZoom + 0.2));
  els.previewZoomReset.addEventListener("click", () => setPreviewZoom(1));

  els.editorZoomOut.addEventListener("click", () => setEditorZoom(state.editorZoom - 0.15));
  els.editorZoomIn.addEventListener("click", () => setEditorZoom(state.editorZoom + 0.15));
  els.editorZoomReset.addEventListener("click", () => setEditorZoom(1));
  els.editorMoreToolsButton?.addEventListener("click", () => {
    if (!els.moreToolsPanel) return;
    els.moreToolsPanel.open = !els.moreToolsPanel.open;
  });
  els.editorToolsCollapse?.addEventListener("click", () => {
    if (els.moreToolsPanel) els.moreToolsPanel.open = false;
  });
  els.editorPaletteSelect.addEventListener("change", syncEditorPalette);
  els.editorToolButtons.forEach((button) => {
    button.addEventListener("click", () => setEditorTool(button.dataset.editorTool || "pencil"));
  });
  els.clearColorButton.addEventListener("click", () => selectEditorColor(null));
  els.undoPaintButton.addEventListener("click", undoPaint);
  els.replaceFrom.addEventListener("change", updateEditorControls);
  els.replaceTo.addEventListener("change", updateEditorControls);
  els.replaceButton.addEventListener("click", replaceColor);
  els.undoReplaceButton.addEventListener("click", undoReplace);
  els.fillSelectionButton?.addEventListener("click", () => applyColorToSelection(state.selectedColor));
  els.clearSelectionButton?.addEventListener("click", () => applyColorToSelection(null));
  els.applyFloatingButton?.addEventListener("click", applyFloatingPattern);
  els.cancelFloatingButton?.addEventListener("click", cancelFloatingPattern);
  els.toggleEditorGrid?.addEventListener("change", updateEditorPrefsFromControls);
  els.toggleEditorCodes?.addEventListener("change", updateEditorPrefsFromControls);
  els.toggleEditorCoords?.addEventListener("change", updateEditorPrefsFromControls);
  els.toggleEditorSnap?.addEventListener("change", updateEditorPrefsFromControls);
  els.editorToolbarPosition?.addEventListener("change", updateEditorPrefsFromControls);
  els.flipHorizontalButton?.addEventListener("click", () => transformEditorGrid("flip-horizontal"));
  els.flipVerticalButton?.addEventListener("click", () => transformEditorGrid("flip-vertical"));
  els.scaleDownButton?.addEventListener("click", () => transformEditorGrid("scale-down"));
  els.scaleUpButton?.addEventListener("click", () => transformEditorGrid("scale-up"));
  els.referenceImageButton?.addEventListener("click", () => els.referenceImageInput?.click());
  els.clearReferenceButton?.addEventListener("click", clearEditorReferenceImage);
  els.referenceImageInput?.addEventListener("change", loadEditorReferenceImage);
  els.referenceOpacity?.addEventListener("input", updateReferenceControls);
  els.referenceScale?.addEventListener("input", updateReferenceControls);
  els.referenceRotation?.addEventListener("input", updateReferenceControls);
  els.referenceVisibleButton?.addEventListener("click", toggleReferenceVisibility);
  els.referenceLockButton?.addEventListener("click", toggleReferenceLock);
  els.referenceNudgeButtons.forEach((button) => button.addEventListener("click", () => nudgeReference(button.dataset.referenceNudge)));
  [els.referenceOpacity, els.referenceScale, els.referenceRotation].forEach((input) => input?.addEventListener("pointerdown", pushReferenceUndo));
  els.patternAdjustButton?.addEventListener("click", () => openPatternAdjustDialog("editor"));
  els.patternAdjustInputs.forEach((input) => input.addEventListener("input", previewPatternAdjustment));
  els.resetPatternAdjustButton?.addEventListener("click", resetPatternAdjustment);
  els.applyPatternAdjustButton?.addEventListener("click", applyPatternAdjustment);
  els.gridAlignButton?.addEventListener("click", openGridAlignDialog);
  [els.gridOffsetX, els.gridOffsetY, els.gridCellWidth, els.gridCellHeight].forEach((input) => input?.addEventListener("input", previewGridAlignment));
  els.autoAlignGridButton?.addEventListener("click", autoEstimateReferenceGrid);
  els.applyGridAlignButton?.addEventListener("click", applyGridAlignment);
  els.patternAdjustModal?.addEventListener("close", cancelPatternAdjustmentPreview);
  els.gridAlignModal?.addEventListener("close", cancelGridAlignmentPreview);
  els.libraryImportSelect?.addEventListener("change", updateLibraryImportButton);
  els.importLibraryButton?.addEventListener("click", importSelectedLibraryItem);
  els.trimArtworkButton?.addEventListener("click", trimEditorArtwork);
  els.fitEditorButton?.addEventListener("click", fitEditorToScreen);
  els.clearArtworkButton?.addEventListener("click", clearEditorArtwork);
  els.assemblyModeButton?.addEventListener("click", startAssemblyMode);
  els.saveLibraryButton?.addEventListener("click", saveEditorToLibrary);
  els.downloadEditorButton?.addEventListener("click", downloadEditorArtwork);
  els.publishCommunityButton?.addEventListener("click", publishEditorArtwork);
  els.cancelEditButton.addEventListener("click", () => els.editorModal.close());
  els.saveEditButton.addEventListener("click", saveEditor);

  els.editorCanvas.addEventListener("pointerdown", (event) => {
    state.isPainting = true;
    state.lastPaintKey = "";
    state.currentPaintAction = [];
    els.editorCanvas.setPointerCapture(event.pointerId);
    handleEditorPointerDown(event);
  });
  els.editorCanvas.addEventListener("pointermove", (event) => {
    if (state.isPainting) handleEditorPointerMove(event);
  });
  window.addEventListener("pointerup", () => {
    finishEditorPointerAction();
  });

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (button.dataset.close === "assembly-modal") {
        event.preventDefault();
        showExitModal();
        return;
      }
      document.querySelector(`#${button.dataset.close}`)?.close();
    });
  });

  [
    els.previewModal,
    els.registerModal,
    els.linkImportModal,
    els.directPatternModal,
    els.assemblyModal,
    els.editorModal,
    els.blankBoardModal,
    els.patternAdjustModal,
    els.gridAlignModal,
  ].forEach((modal) => {
    if (!modal) return;
    modal.addEventListener("click", (event) => {
      if (event.target !== modal) return;
      if (modal === els.assemblyModal) {
        showExitModal();
        return;
      }
      modal.close();
    });
  });
  els.assemblyModal?.addEventListener("close", clearAssemblyFocusMode);
  els.assemblyModal?.addEventListener("cancel", (event) => {
    event.preventDefault();
    showExitModal();
  });
}

function bindRangePair(name, min, max) {
  const range = els[`${name}Input`];
  const number = els[`${name}Number`];
  const apply = els[`${name}Apply`];
  if (!range || !number) return;

  range.addEventListener("input", () => {
    syncRangeControls(name, range.value, min, max);
    scheduleLivePreview(name === "granularity" ? "宽度已更新" : "颜色合并已更新");
  });

  const commit = () => {
    syncRangeControls(name, number.value, min, max);
    scheduleLivePreview(name === "granularity" ? "宽度已更新" : "颜色合并已更新");
  };
  number.addEventListener("change", commit);
  apply?.addEventListener("click", commit);
}

function syncRangeControls(name, value, min, max) {
  const next = Math.round(clamp(Number(value) || min, min, max));
  const range = els[`${name}Input`];
  const number = els[`${name}Number`];
  const output = els[`${name}Output`];
  if (range) range.value = String(next);
  if (number) number.value = String(next);
  if (output) output.textContent = String(next);
  if (name === "granularity") {
    if (els.mobileGranularityInput) els.mobileGranularityInput.value = String(next);
    if (els.mobileGranularityOutput) els.mobileGranularityOutput.textContent = String(next);
  }
  return next;
}

function getGranularity() {
  return syncRangeControls(
    "granularity",
    els.granularityInput?.value || DEFAULT_GRANULARITY,
    10,
    500,
  );
}

function getSimilarityThreshold() {
  return syncRangeControls("similarity", els.similarityInput?.value || 30, 0, 100);
}

function getSelectedBrandProfile() {
  return BRAND_PROFILES[state.selectedBrand] || BRAND_PROFILES[DEFAULT_BRAND];
}

function getSelectedPaletteSize() {
  const profile = getSelectedBrandProfile();
  const requested = Number(els.paletteSelect?.value || DEFAULT_PALETTE_SIZE);
  return profile.options.includes(requested) ? requested : DEFAULT_PALETTE_SIZE;
}

function getCurrentPaletteKey() {
  return getPaletteKey(state.selectedBrand, getSelectedPaletteSize());
}

function getCurrentPalette() {
  return PALETTES[getCurrentPaletteKey()] || PALETTES[getPaletteKey(DEFAULT_BRAND, DEFAULT_PALETTE_SIZE)];
}

function getEditorPalette() {
  return (
    PALETTES[els.editorPaletteSelect?.value] ||
    getCurrentPalette() ||
    PALETTES[getPaletteKey(DEFAULT_BRAND, DEFAULT_PALETTE_SIZE)]
  );
}

function getCurrentPaletteLabel() {
  const profile = getSelectedBrandProfile();
  return `${profile.label}-${getSelectedPaletteSize()}`;
}

function getPaletteLabelForKey(key) {
  const [brand, count] = String(key || "").split("-");
  const profile = BRAND_PROFILES[brand];
  return profile && count ? `${profile.label}-${count}` : getCurrentPaletteLabel();
}

function getChartPaletteLabel() {
  return state.paletteLabel || getCurrentPaletteLabel();
}

function updatePaletteOptions() {
  if (!els.paletteSelect) return;
  const profile = getSelectedBrandProfile();
  const current = Number(els.paletteSelect.value || DEFAULT_PALETTE_SIZE);
  els.paletteSelect.replaceChildren(
    ...profile.options
      .slice()
      .sort((a, b) => b - a)
      .map((count) => new Option(`${count} 色`, String(count))),
  );
  // 原来的回落写死 DEFAULT_PALETTE_SIZE(221)。第三方品牌的可用档位是它自己的官方色数
  // （优肯 197 / COCO 官方 291 等根本没有 221 这一档），回落到一个不存在的 option 会让
  // select.value 变空，进而静默掉回默认 mard-221 色板。这里改为：优先原尺寸 → 默认尺寸
  // → 该品牌自己的第一个档位（内建 5 个品牌都含 221，行为完全不变）。
  const fallback = profile.options.includes(DEFAULT_PALETTE_SIZE)
    ? DEFAULT_PALETTE_SIZE
    : profile.options[0] ?? DEFAULT_PALETTE_SIZE;
  els.paletteSelect.value = String(profile.options.includes(current) ? current : fallback);
}

function updateEditorPaletteOptions() {
  if (!els.editorPaletteSelect) return;
  const profile = getSelectedBrandProfile();
  const selectedSize = getSelectedPaletteSize();
  els.editorPaletteSelect.replaceChildren(
    ...profile.options
      .slice()
      .sort((a, b) => b - a)
      .map((count) => new Option(`${profile.label} ${count} 色`, getPaletteKey(state.selectedBrand, count))),
  );
  els.editorPaletteSelect.value = getPaletteKey(state.selectedBrand, selectedSize);
}

function selectBrand(brand) {
  if (!BRAND_PROFILES[brand]) return;
  state.selectedBrand = brand;
  // 动态查询而非复用 els.brandButtons 快照 —— 第三方品牌 chip 是异步追加的。
  document.querySelectorAll("[data-brand]").forEach((button) => {
    const active = button.dataset.brand === brand;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updatePaletteOptions();
  updateEditorPaletteOptions();
  updatePaletteCount();
  updateResultUi();
  scheduleLivePreview("品牌色板已更新");
}

function markPaletteChanged() {
  if (state.grid.length) setStatus("色板已变更，重新生成后生效");
}

function scheduleLivePreview(message = "参数已更新") {
  if (!state.sourceDataUrl) {
    if (state.grid.length) setStatus(`${message}，重新生成后生效`);
    return;
  }
  window.clearTimeout(state.livePreviewTimer);
  setStatus(`${message}，正在准备预览`);
  state.livePreviewTimer = window.setTimeout(() => {
    processImage({ autoPreview: true, saveGallery: false });
  }, LIVE_PREVIEW_DELAY);
}

function updatePaletteCount() {
  if (!els.paletteCount) return;
  els.paletteCount.textContent = String(getCurrentPalette().length);
}

function updateMaxColorPresetUi() {
  const value = String(clamp(Number(els.maxColorsInput?.value || 0), 0, getSelectedPaletteSize()));
  if (els.maxColorsInput) els.maxColorsInput.value = value;
  els.maxColorPresetButtons.forEach((button) => {
    const active = button.dataset.maxColors === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (els.paletteBudgetStatus && !state.grid.length) {
    els.paletteBudgetStatus.textContent = value === "0" ? "自动：根据画布与图像复杂度推荐。" : `最大颜色：${value}；生成结果将严格不超过该数量。`;
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
    return;
  }
  document.exitFullscreen?.();
}

function openRegisterModal() {
  const profile = getInviteProfile();
  els.registerName.value = profile?.name || "";
  els.inviteCode.value = profile?.code || DEFAULT_INVITE_CODE;
  els.registerMessage.textContent = profile
    ? `已注册：${profile.name}`
    : "邀请码由项目维护者发放。公益项目不展示购买入口。";
  els.registerModal?.showModal();
}

function registerWithInvite(event) {
  event.preventDefault();
  const name = els.registerName.value.trim();
  const code = els.inviteCode.value.trim().toUpperCase();

  if (!name) {
    els.registerMessage.textContent = "请先填写创作者名称。";
    return;
  }

  if (!isValidInviteCode(code)) {
    els.registerMessage.textContent = `邀请码无效。当前默认邀请码为 ${DEFAULT_INVITE_CODE}。`;
    return;
  }

  localStorage.setItem(
    "libai-maker-invite-profile",
    JSON.stringify({ name, code, registeredAt: new Date().toISOString() }),
  );
  updateInviteUi();
  els.registerModal.close();
}

function isValidInviteCode(code) {
  return code === DEFAULT_INVITE_CODE;
}

function getInviteProfile() {
  try {
    const raw = localStorage.getItem("libai-maker-invite-profile");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function updateInviteUi() {
  const profile = getInviteProfile();
  if (els.inviteStatus) {
    els.inviteStatus.textContent = profile ? `已注册：${profile.name}` : "未注册";
    els.inviteStatus.classList.toggle("registered", Boolean(profile));
  }
  if (els.registerOpenButton) {
    els.registerOpenButton.textContent = profile ? "已注册" : "邀请注册";
  }
  if (els.registerOpenButtonSide) {
    els.registerOpenButtonSide.textContent = profile ? "查看注册信息" : "输入邀请码注册";
  }
}

function startManualImport() {
  state.importMode = "photo";
  state.autoProcessAfterLoad = false;
  state.restoreAutoSizePending = false;
  state.backgroundDecision = "";
  state.paletteBudget = null;
  if (els.modeSelect) els.modeSelect.value = "dominant";
  if (els.backgroundModeSelect) els.backgroundModeSelect.value = "auto";
  syncRangeControls("similarity", 30, 0, 100);
  setStatus("导入图片");
  els.fileInput.value = "";
  els.fileInput.click();
}

function startPhotoImport() {
  state.importMode = "photo";
  state.autoProcessAfterLoad = true;
  state.restoreAutoSizePending = false;
  state.backgroundDecision = "";
  if (els.modeSelect) els.modeSelect.value = "dominant";
  if (els.backgroundModeSelect) els.backgroundModeSelect.value = "auto";
  syncRangeControls("similarity", 30, 0, 100);
  setStatus("照片转图纸");
  els.fileInput.value = "";
  els.fileInput.click();
}

function startRestoreImport() {
  state.importMode = "restore";
  state.autoProcessAfterLoad = true;
  state.restoreAutoSizePending = true;
  state.backgroundDecision = "";
  if (els.modeSelect) els.modeSelect.value = "palette";
  if (els.backgroundModeSelect) els.backgroundModeSelect.value = "keep";
  syncRangeControls("similarity", 0, 0, 100);
  setStatus("像素图直标");
  els.fileInput.value = "";
  els.fileInput.click();
}

function startDirectPatternImport() {
  state.importMode = "directPattern";
  state.directPatternFile = null;
  setStatus("已有图纸直接拼");
  if (els.directPatternMessage) {
    els.directPatternMessage.textContent = "请选择已经做好的像素图纸，再填写横向和纵向格数。";
  }
  if (els.directPatternFileInput) {
    els.directPatternFileInput.value = "";
    els.directPatternFileInput.click();
  }
}

function handleDirectPatternFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!isImageFile(file)) {
    setStatus("请用 PNG/JPG");
    return;
  }
  state.directPatternFile = file;
  const defaultWidth = Number(els.granularityInput?.value || DEFAULT_GRANULARITY);
  if (els.directPatternWidth) els.directPatternWidth.value = String(clamp(defaultWidth, 1, 500));
  if (els.directPatternHeight) els.directPatternHeight.value = String(clamp(defaultWidth, 1, 500));
  if (els.directPatternMessage) {
    els.directPatternMessage.textContent = `已选择：${file.name}。请填写图纸实际格数。`;
  }
  els.directPatternModal?.showModal();
  els.directPatternWidth?.focus();
}

async function handleDirectPatternSubmit(event) {
  event.preventDefault();
  const file = state.directPatternFile;
  const gridWidth = Math.floor(Number(els.directPatternWidth?.value || 0));
  const gridHeight = Math.floor(Number(els.directPatternHeight?.value || 0));
  if (!file) {
    if (els.directPatternMessage) els.directPatternMessage.textContent = "请先选择一张图纸图片。";
    return;
  }
  if (gridWidth < 1 || gridHeight < 1 || gridWidth > 500 || gridHeight > 500) {
    if (els.directPatternMessage) els.directPatternMessage.textContent = "格数需要在 1 到 500 之间。";
    return;
  }
  try {
    setStatus("扫描图纸中");
    if (els.directPatternMessage) els.directPatternMessage.textContent = "正在读取每个格子的中心颜色...";
    await scanReadyMadePattern(file, gridWidth, gridHeight);
    els.directPatternModal?.close();
    openAssemblyPlayer();
  } catch (error) {
    console.error(error);
    setStatus("扫描失败");
    if (els.directPatternMessage) {
      els.directPatternMessage.textContent = "扫描失败，请确认图片清晰，并且格数填写正确。";
    }
  }
}

function startOcrImport() {
  state.importMode = "ocr";
  state.autoProcessAfterLoad = true;
  state.restoreAutoSizePending = true;
  state.backgroundDecision = "";
  if (els.modeSelect) els.modeSelect.value = "palette";
  if (els.backgroundModeSelect) els.backgroundModeSelect.value = "keep";
  syncRangeControls("similarity", 0, 0, 100);
  setStatus("OCR 预处理");
  els.fileInput.value = "";
  els.fileInput.click();
}

function openLinkImportModal() {
  state.importMode = "photo";
  state.autoProcessAfterLoad = true;
  state.restoreAutoSizePending = false;
  if (els.linkImportUrl) els.linkImportUrl.value = "";
  if (els.linkImportMessage) {
    els.linkImportMessage.textContent = "支持可直接访问的 JPG / PNG / WEBP 图片链接。";
  }
  els.linkImportModal?.showModal();
  els.linkImportUrl?.focus();
}

async function importImageFromLink(event) {
  event.preventDefault();
  const url = els.linkImportUrl?.value.trim();
  if (!url) {
    els.linkImportMessage.textContent = "请先粘贴图片直链。";
    return;
  }

  try {
    setStatus("链接导入中");
    els.linkImportMessage.textContent = "正在读取图片...";
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
      els.linkImportMessage.textContent = "这个链接不是可识别的图片文件。";
      setStatus("导入失败");
      return;
    }
    const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const file = new File([blob], `link-import.${extension}`, { type: blob.type });
    loadFile(file);
    els.linkImportModal?.close();
  } catch (error) {
    console.error(error);
    els.linkImportMessage.textContent = "导入失败。请确认链接是图片直链，并允许浏览器跨域读取。";
    setStatus("导入失败");
  }
}

function showTutorialHint() {
  setStatus("使用教程");
  window.alert("流程：上传图片或链接导入 -> 选择横向格数、色板和处理模式 -> 生成图纸 -> 选择 52/78/104 分版 -> 下载 8K 高清图纸。");
}

function updateVisitCount() {
  if (!els.visitCount) return;
  const key = "bead-studio-local-visits";
  const count = Number(localStorage.getItem(key) || "0") + 1;
  localStorage.setItem(key, String(count));
  els.visitCount.textContent = `本地第 ${count} 次打开`;
}

function enableMiddleButtonPan(element) {
  if (!element) return;

  const pan = {
    active: false,
    x: 0,
    y: 0,
    left: 0,
    top: 0,
  };

  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 1 || element.disabled) return;
    event.preventDefault();
    event.stopPropagation();

    pan.active = true;
    pan.x = event.clientX;
    pan.y = event.clientY;
    pan.left = element.scrollLeft;
    pan.top = element.scrollTop;
    element.classList.add("middle-panning");
    element.setPointerCapture?.(event.pointerId);
  });

  element.addEventListener("pointermove", (event) => {
    if (!pan.active) return;
    event.preventDefault();
    element.scrollLeft = pan.left - (event.clientX - pan.x);
    element.scrollTop = pan.top - (event.clientY - pan.y);
  });

  const stop = (event) => {
    if (!pan.active) return;
    pan.active = false;
    element.classList.remove("middle-panning");
    if (element.hasPointerCapture?.(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
  };

  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);
  element.addEventListener("lostpointercapture", stop);
  element.addEventListener("auxclick", (event) => {
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

async function loadFile(file) {
  if (state.manualEdited && !state.importApproved) { setStatus("手动修改尚未确认覆盖，请先使用工作台的换图操作"); return; }
  state.importApproved = false;
  if (!isImageFile(file)) {
    setStatus("请用 PNG/JPG");
    state.autoProcessAfterLoad = false;
    state.restoreAutoSizePending = false;
    state.backgroundDecision = "";
    state.sourceSafetyChecked = false;
    return;
  }

  if (state.importMode === "restore" || state.importMode === "ocr") {
    if (els.modeSelect) els.modeSelect.value = "palette";
    syncRangeControls("similarity", 0, 0, 100);
  }

  try {
    setStatus("读取图片");
    els.processButton.disabled = true;
    const prepared = await prepareLocalImage(file);
    setStatus("本地审查中");
    const safety = await runLocalContentSafetyCheck(prepared.dataUrl);
    if (!safety.allowed) {
      state.sourceDataUrl = "";
      state.sourceName = "";
      state.sourceSafetyChecked = false;
      state.autoProcessAfterLoad = false;
      state.restoreAutoSizePending = false;
      state.backgroundDecision = "";
      els.sourcePreview.hidden = true;
      els.sourcePreview.removeAttribute("src");
      els.uploadZone.classList.remove("has-image", "drag-over");
      clearResult();
      setStatus("图片疑似违规");
      window.alert("检测到图片可能包含违规内容，无法生成");
      return;
    }

    state.sourceDataUrl = prepared.dataUrl;
    state.processedSourceDataUrl = "";
    state.sourceTransform = { crop: null, cropRatio: "free", rotation: 0, flipX: false, flipY: false,
      brightness: 0, contrast: 0, saturation: 0, sharpen: 0,
      expand: { top: 0, bottom: 0, left: 0, right: 0 }, background: "#ffffff" };
    const loadedSource = await loadImage(prepared.dataUrl);
    state.sourceNaturalWidth = loadedSource.naturalWidth;
    state.sourceNaturalHeight = loadedSource.naturalHeight;
    state.sourceName = file.name;
    window.dispatchEvent(new CustomEvent("libms:source-loaded", { detail: { name: file.name, url: prepared.dataUrl, width: state.sourceNaturalWidth, height: state.sourceNaturalHeight } }));
    state.sourceSafetyChecked = true;
    els.sourcePreview.src = state.sourceDataUrl;
    els.sourcePreview.hidden = false;
    els.uploadZone.classList.add("has-image");
    els.processButton.disabled = false;
    state.backgroundDecision = "";
    clearResult();
    const uploadStatus =
      state.importMode === "restore"
        ? "正在还原"
        : state.importMode === "ocr"
          ? "正在预处理"
          : "已上传";
    setStatus(uploadStatus);
    if (state.autoProcessAfterLoad) {
      state.autoProcessAfterLoad = false;
      requestAnimationFrame(() => {
        processImage();
      });
    }
  } catch (error) {
    console.error(error);
    state.autoProcessAfterLoad = false;
    state.restoreAutoSizePending = false;
    setStatus("读取失败");
  } finally {
    els.processButton.disabled = !state.sourceDataUrl;
  }
}

async function prepareLocalImage(file) {
  const dataUrl = await readFileAsDataUrl(file);
  return {
    dataUrl,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function runLocalContentSafetyCheck(dataUrl) {
  const model = await loadLocalSafetyModel();
  if (!model) return { allowed: true, skipped: true };
  const image = await loadImage(dataUrl);
  const predictions = await model.classify(image);
  const blocked = predictions.find(({ className, probability }) => {
    const threshold = NSFW_THRESHOLDS[className];
    return threshold && probability >= threshold;
  });
  return blocked
    ? { allowed: false, reason: `${blocked.className}:${blocked.probability.toFixed(3)}` }
    : { allowed: true, predictions };
}

async function loadLocalSafetyModel() {
  if (state.safetyModel) return state.safetyModel;
  if (state.safetyModelUnavailable) return null;
  if (state.safetyModelLoading) return state.safetyModelLoading;
  state.safetyModelLoading = (async () => {
    try {
      if (!window.tf) await loadScriptOnce(TFJS_SCRIPT_URL);
      if (!window.nsfwjs) await loadScriptOnce(NSFWJS_SCRIPT_URL);
      if (!window.nsfwjs?.load) return null;
      state.safetyModel = await withTimeout(window.nsfwjs.load(), SAFETY_MODEL_LOAD_TIMEOUT);
      return state.safetyModel;
    } catch (error) {
      console.warn("Local content safety model unavailable", error);
      state.safetyModelUnavailable = true;
      return null;
    } finally {
      state.safetyModelLoading = null;
    }
  })();
  return state.safetyModelLoading;
}

function loadScriptOnce(src) {
  if (externalScriptLoads.has(src)) return externalScriptLoads.get(src);
  const load = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      externalScriptLoads.delete(src);
      reject(new Error(`Script timeout: ${src}`));
    }, SAFETY_SCRIPT_LOAD_TIMEOUT);

    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      externalScriptLoads.delete(src);
      reject(new Error(`Script failed: ${src}`));
    };
    document.head.append(script);
  });
  externalScriptLoads.set(src, load);
  return load;
}

function withTimeout(promise, timeout) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Model timeout")), timeout);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function imageToImageData(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas context unavailable");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function mapDetailProtectionValue(value) {
  return value === "low" ? 0.5 : value === "high" ? 0.9 : 0.7;
}

/**
 * 生产链路 V2.5 的选项映射。
 *
 * 从 processImageV2 里原样抽出（逐字段一致），目的是让 A/B 对比器里的 `current` 一侧
 * 用的是**同一个函数**产出的配置，而不是手抄一份可能漂移的副本。
 */
function buildV25Options(options = {}, maxColors = 0) {
  const detailProtection = mapDetailProtectionValue(els.detailProtectionSelect?.value || "standard");
  return {
    preset: options.preset || state.generationPreset || "auto",
    sampling: options.sampling || state.generationSampling || "auto",
    detailProtection: options.detailProtection == null ? detailProtection : options.detailProtection / 100,
    edgeProtection: options.edgeProtection == null ? detailProtection : options.edgeProtection / 100,
    highlightProtection: options.preserveHighlights === false ? 0 : 0.8,
    eyeProtection: options.preserveEyes === false ? 0 : 1.0,
    microDetailProtection: options.preserveMicroDetails === false ? 0 : 0.8,
    maxColors: maxColors || 0,
    // V2.5 智能辅助（小白一键）：四开关全部默认关，只有显式打开才进入相应分支，
    // 因此不开时与旧链路逐位一致，冻结基线不受影响。
    subjectCrop: options.subjectCrop === true,
    autoBackground: options.autoBackground === true,
    strokeProtection: options.strokeProtection === true,
    accentProtection: options.accentProtection === true,
  };
}

async function processImageV2(image, palette, { width, height, maxColors, options = {}, saveGallery = true }) {
  const startedAt = performance.now();
  const sourceImageData = imageToImageData(image);
  const { generateV2 } = await import("./smart-preprocessing/generation-engine-v2.mjs?v=20260918-usage2");
  const result = generateV2({
    source: sourceImageData,
    width,
    height,
    palette,
    options: buildV25Options(options, maxColors),
  });
  state.grid = result.grid.map((row) => row.map((cell) => {
    if (!cell) return null;
    const rgbValue = Array.isArray(cell.rgb) ? cell.rgb : [cell.rgb?.[0] ?? 0, cell.rgb?.[1] ?? 0, cell.rgb?.[2] ?? 0];
    return { code: cell.code, rgb: [...rgbValue], hex: cell.hex || rgbToHex(rgbValue) };
  }));
  state.width = result.width;
  state.height = result.height;
  state.manualEdited = false;
  state.stats = calculateStats(state.grid);
  state.generationMilliseconds = Math.round(performance.now() - startedAt);
  state.generationEngineLast = "v2.5";
  state.algorithmEngineLast = "current";
  state.generationOriginalGrid = cloneGrid(state.grid);
  state.generationOptimizedGrid = null;
  state.optimizerReport = null;
  state.showingOptimizedGrid = true;
  state.paletteBudget = { mode: maxColors ? "fixed" : "auto", requested: maxColors || null, recommended: result.diagnostics?.colorsAfterBudget || state.stats.length, effective: maxColors || 0 };
  state.smartFeatures = result.diagnostics?.smartFeatures || null;
  state.smartReport = {
    subjectCrop: result.diagnostics?.subjectCrop || null,
    autoBackground: result.diagnostics?.autoBackground || null,
    strokeProtection: result.diagnostics?.strokeProtection || null,
    accentProtection: result.diagnostics?.accentProtection || null,
  };
  state.backgroundDecision = "";
  state.paletteLabel = getCurrentPaletteLabel();
  state.assemblyHideCellText = false;
  refreshChartUrl();
  updateResultUi();
  updateOptimizationToggle();
  window.dispatchEvent(new CustomEvent("libms:project-result", { detail: window.LibmsWorkspaceBridge?.getResult() }));
  if (saveGallery) saveCurrentToGallery();
  setStatus(getGeneratedStatus());
  return true;
}

async function processProductionV2(options = {}) {
  if (!state.sourceDataUrl) throw new Error("请先上传图片");
  if (state.manualEdited && !options.overwriteApproved) throw new Error("手动编辑尚未确认覆盖");
  if (state.isProcessingImage) throw new Error("正在生成，请稍候");
  state.isProcessingImage = true;
  state.lastGenerationError = "";
  setStatus("V2.5 正在生成");
  els.processButton.disabled = true;
  try {
    const original = await loadImage(state.sourceDataUrl);
    const sourceEditor = await import("./services/source-editor-service.js?v=20260916-phase35-source1");
    state.processedSourceDataUrl = sourceEditor.hasSourceTransform(state.sourceTransform)
      ? sourceEditor.renderSourceTransform(original, state.sourceTransform).toDataURL("image/png") : state.sourceDataUrl;
    const image = state.processedSourceDataUrl === state.sourceDataUrl ? original : await loadImage(state.processedSourceDataUrl);
    state.sourceNaturalWidth = image.naturalWidth;
    state.sourceNaturalHeight = image.naturalHeight;
    const palette = getCurrentPalette();
    return await processImageV2(image, palette, {
      width: getGranularity(), height: getGenerationTargetHeight(image, getGranularity()),
      maxColors: clamp(Number(els.maxColorsInput?.value || 0), 0, palette.length),
      options: state.productionGenerationOptions || {}, saveGallery: options.saveGallery !== false,
    });
  } catch (error) {
    state.lastGenerationError = error.message || String(error);
    setStatus(`V2.5 失败：${state.lastGenerationError}。可选择 Legacy 重试`);
    window.dispatchEvent(new CustomEvent("libms:generation-error", { detail: state.lastGenerationError }));
    console.error("Production V2.5 generation failed", error);
    return false;
  } finally {
    state.isProcessingImage = false;
    els.processButton.disabled = false;
  }
}

/* ─────────────────────────────────────────────────────────────
 * 算法引擎 BGS（Batch E）
 *
 * 纯算法模块 src/algorithms/bgs 的宿主适配层。它只做两件事：
 *   1. 把 libms 的运行时上下文（源图 imageData、调色板、目标尺寸、颜色上限）翻译成
 *      convertImageToBeads(imageData, options) 的参数；
 *   2. 把返回的「纯拼豆颜色矩阵」写回唯一事实源 state.grid。
 *
 * 模块本身不碰 DOM / Canvas / state —— 矩阵之外没有任何 UI 状态，所以它能被 Node 直接单测。
 * 这条链路是**平行新增**的：processProductionV2 与 processImage 的既有分支一行未改。
 * ───────────────────────────────────────────────────────────── */

const BGS_MODULE_QUERY = "?v=20260918-bgs1";

/** bgs 的白/黑锚点按色号声明；libms 的色卡品牌不同，色号不存在时传空串让它自动挑最亮/最暗中性色。 */
function bgsAnchorCodes(palette) {
  const codes = new Set(palette.map((color) => String(color.code).toUpperCase()));
  return {
    whiteCode: codes.has("H2") ? "H2" : "",
    blackCode: codes.has("H7") ? "H7" : "",
  };
}

/** 把当前界面的保护档位（0–100）折算成 bgs 的口径。 */
function bgsProtectionOptions() {
  const options = state.productionGenerationOptions || {};
  const detail = Number.isFinite(Number(options.detailProtection)) ? Number(options.detailProtection) : mapDetailProtectionValue(els.detailProtectionSelect?.value || "standard");
  const edge = Number.isFinite(Number(options.edgeProtection)) ? Number(options.edgeProtection) : detail;
  return {
    edgeProtection: clamp(edge * 2, 0, 2),
    cleanupStrength: clamp(Number.isFinite(Number(options.cleanupStrength)) ? Number(options.cleanupStrength) : 0.5, 0, 1),
  };
}

/** 加载「与生产链路完全一致」的源图 imageData：同一份 sourceTransform 结果，两个引擎共用。 */
async function loadProductionRaster() {
  if (!state.sourceDataUrl) throw new Error("请先上传图片");
  const original = await loadImage(state.sourceDataUrl);
  const sourceEditor = await import("./services/source-editor-service.js?v=20260916-phase35-source1");
  state.processedSourceDataUrl = sourceEditor.hasSourceTransform(state.sourceTransform)
    ? sourceEditor.renderSourceTransform(original, state.sourceTransform).toDataURL("image/png") : state.sourceDataUrl;
  const image = state.processedSourceDataUrl === state.sourceDataUrl ? original : await loadImage(state.processedSourceDataUrl);
  state.sourceNaturalWidth = image.naturalWidth;
  state.sourceNaturalHeight = image.naturalHeight;
  return { image, imageData: imageToImageData(image) };
}

/** 纯矩阵 → state.grid 单元。bgs 的 matrix 单元是色号（或 null），这里换回 libms 的色对象。 */
function gridFromBgsMatrix(matrix, palette) {
  const byCode = new Map(palette.map((color) => [String(color.code), color]));
  let unknown = 0;
  const grid = matrix.map((row) => row.map((code) => {
    if (code == null) return null;
    const color = byCode.get(String(code));
    if (!color) { unknown++; return null; }
    const cell = { code: color.code, rgb: [...color.rgb], hex: color.hex || rgbToHex(color.rgb) };
    if (color.name) cell.name = color.name;
    return cell;
  }));
  return { grid, unknown };
}

/** 把一次 bgs 结果落到 state（与 processImageV2 的收尾逐项对应）。 */
function applyBgsResult(result, { maxColors, startedAt, unknownCodes }) {
  state.grid = result.grid;
  state.width = result.width;
  state.height = result.height;
  state.manualEdited = false;
  state.stats = calculateStats(state.grid);
  state.generationMilliseconds = Math.round(performance.now() - startedAt);
  state.algorithmEngineLast = "bgs";
  state.generationOriginalGrid = cloneGrid(state.grid);
  state.generationOptimizedGrid = null;
  state.optimizerReport = null;
  state.showingOptimizedGrid = true;
  state.paletteBudget = {
    mode: maxColors ? "fixed" : "auto",
    requested: maxColors || null,
    recommended: result.diagnostics?.colors?.usedAfterLimit ?? state.stats.length,
    effective: maxColors || 0,
  };
  // BGS 不使用 V2.5 的四个智能开关，显式清空以免上一轮的诊断被误读成这一轮的。
  state.smartFeatures = null;
  state.smartReport = { subjectCrop: null, autoBackground: null, strokeProtection: null, accentProtection: null };
  state.bgsReport = {
    engine: result.diagnostics?.engine || "bgs",
    moduleVersion: result.diagnostics?.moduleVersion || null,
    unknownCodes,
    statistics: result.statistics,
    diagnostics: result.diagnostics,
  };
  state.backgroundDecision = "";
  state.paletteLabel = getCurrentPaletteLabel();
  state.assemblyHideCellText = false;
  refreshChartUrl();
  updateResultUi();
  updateOptimizationToggle();
  window.dispatchEvent(new CustomEvent("libms:project-result", { detail: window.LibmsWorkspaceBridge?.getResult() }));
}

async function processProductionBgs(options = {}) {
  if (!state.sourceDataUrl) throw new Error("请先上传图片");
  if (state.manualEdited && !options.overwriteApproved) throw new Error("手动编辑尚未确认覆盖");
  if (state.isProcessingImage) throw new Error("正在生成，请稍候");
  state.isProcessingImage = true;
  state.lastGenerationError = "";
  setStatus("BGS 算法正在生成");
  els.processButton.disabled = true;
  const startedAt = performance.now();
  try {
    const { convertImageToBeads } = await import(`./src/algorithms/bgs/index.mjs${BGS_MODULE_QUERY}`);
    const { image, imageData } = await loadProductionRaster();
    const palette = getCurrentPalette();
    const width = getGranularity();
    // 与 V2.5 同一条高度规则：按原图比例（锁定时）或用户指定高度。
    const height = getGenerationTargetHeight(image, width);
    const maxColors = clamp(Number(els.maxColorsInput?.value || 0), 0, palette.length);
    const protection = bgsProtectionOptions();

    const result = convertImageToBeads(imageData, {
      width,
      height,
      maxColors,
      palette,
      // libms 的高度已经按原图比例算好，所以这里让 bgs 直接采用这对尺寸，不再二次缩放。
      preserveAspectRatio: false,
      samplingMode: state.productionGenerationOptions?.sampling || state.generationSampling || "auto",
      topologyProtection: "auto",
      edgeProtection: protection.edgeProtection,
      cleanupStrength: protection.cleanupStrength,
      autoCrop: state.productionGenerationOptions?.subjectCrop === true,
      ...bgsAnchorCodes(palette),
    });

    const { grid, unknown } = gridFromBgsMatrix(result.matrix, palette);
    applyBgsResult({ ...result, grid }, { maxColors, startedAt, unknownCodes: unknown });
    if (options.saveGallery !== false) saveCurrentToGallery();
    setStatus(getGeneratedStatus());
    return true;
  } catch (error) {
    state.lastGenerationError = error.message || String(error);
    setStatus(`BGS 算法失败：${state.lastGenerationError}`);
    window.dispatchEvent(new CustomEvent("libms:generation-error", { detail: state.lastGenerationError }));
    console.error("BGS algorithm generation failed", error);
    return false;
  } finally {
    state.isProcessingImage = false;
    els.processButton.disabled = false;
  }
}

/* ============================================================
 * Batch F —— pindou-workbench 算法模块的宿主适配层
 *
 * 与 BGS 完全同一套写法：只做「上下文翻译」+「写回 state.grid」。
 * 两个新引擎（pindou-workbench / hybrid-pw）都是**平行新增**：
 * 既有分支一行未改，默认仍是 current，不选它们就完全走不到这里。
 *
 * 上游是单文件 27KB 小工具，README 宣传的 5×5 Sobel / 背景 K-means /
 * 边缘直方图 / 高斯羽化在代码里并不存在（详见
 * docs/algorithm-audit-pindou-workbench.md §1）。本模块只借鉴其**已存在**
 * 的算法思想，标 LIBMS_FILL 的部分是本仓库补全，不含上游代码。
 * ───────────────────────────────────────────────────────────── */

const PW_MODULE_QUERY = "?v=20260918-pw1";

/** 四套算法引擎并存，默认 current。任何一套都不能静默替换另一套的结果。 */
const ALGORITHM_ENGINES = new Set(["current", "bgs", "pindou-workbench", "hybrid-pw"]);

/** pw 矩阵单元同样是「色号字符串或 null」，与 bgs 同形，直接复用同一套换色逻辑。 */
function gridFromPwMatrix(matrix, palette) {
  return gridFromBgsMatrix(matrix, palette);
}

/** 把一次 pw / hybrid-pw 结果落到 state（与 BGS 收尾逐项对应）。 */
function applyPwResult(result, { engine, maxColors, startedAt, unknownCodes }) {
  state.grid = result.grid;
  state.width = result.width;
  state.height = result.height;
  state.manualEdited = false;
  state.stats = calculateStats(state.grid);
  state.generationMilliseconds = Math.round(performance.now() - startedAt);
  state.algorithmEngineLast = engine;
  state.generationOriginalGrid = cloneGrid(state.grid);
  state.generationOptimizedGrid = null;
  state.optimizerReport = null;
  state.showingOptimizedGrid = true;
  state.paletteBudget = {
    mode: maxColors ? "fixed" : "auto",
    requested: maxColors || null,
    recommended: result.statistics?.usedColors?.length ?? state.stats.length,
    effective: maxColors || 0,
  };
  // 与 BGS 同理：不使用 V2.5 的四个智能开关，显式清空以免上一轮诊断被误读。
  state.smartFeatures = null;
  state.smartReport = { subjectCrop: null, autoBackground: null, strokeProtection: null, accentProtection: null };
  state.pwReport = {
    engine,
    moduleVersion: result.diagnostics?.moduleVersion || null,
    unknownCodes,
    statistics: result.statistics,
    diagnostics: result.diagnostics,
  };
  state.backgroundDecision = "";
  state.paletteLabel = getCurrentPaletteLabel();
  state.assemblyHideCellText = false;
  refreshChartUrl();
  updateResultUi();
  updateOptimizationToggle();
  window.dispatchEvent(new CustomEvent("libms:project-result", { detail: window.LibmsWorkspaceBridge?.getResult() }));
}

/**
 * pindou-workbench / hybrid-pw 的生产链路入口。
 *
 * 两个引擎共用这套上下文翻译，只在最后一步分流：
 *   - pindou-workbench：纯上游思路复现（同步）
 *   - hybrid-pw：pw 多尺度 Sobel → 结构 Mask → libms Linear RGB 采样
 *     → libms CIEDE2000 匹配 → 保护 → 降色 → 清理（异步，动态 import libms 模块）
 */
async function processProductionPw(options = {}) {
  const engine = state.algorithmEngine === "hybrid-pw" ? "hybrid-pw" : "pindou-workbench";
  if (!state.sourceDataUrl) throw new Error("请先上传图片");
  if (state.manualEdited && !options.overwriteApproved) throw new Error("手动编辑尚未确认覆盖");
  if (state.isProcessingImage) throw new Error("正在生成，请稍候");
  state.isProcessingImage = true;
  state.lastGenerationError = "";
  setStatus(engine === "hybrid-pw" ? "HYBRID-PW 混合管线正在生成" : "PW 算法正在生成");
  els.processButton.disabled = true;
  const startedAt = performance.now();
  try {
    const { image, imageData } = await loadProductionRaster();
    const palette = getCurrentPalette();
    const width = getGranularity();
    const height = getGenerationTargetHeight(image, width);
    const maxColors = clamp(Number(els.maxColorsInput?.value || 0), 0, palette.length);

    const shared = {
      width,
      height,
      maxColors,
      palette,
      preserveAspectRatio: false,
      // 色板匹配三档中的哪一档由界面档位决定；默认 CIEDE2000（与 libms 既有色差口径一致）。
      paletteMatchMode: state.pwPaletteMatchMode || "ciede2000",
    };

    let result;
    if (engine === "hybrid-pw") {
      const { runHybridPw } = await import(`./src/algorithms/pindou-workbench/index.js${PW_MODULE_QUERY}`);
      result = await runHybridPw(imageData, { ...shared, ...(state.pwHybridOptions || {}) });
    } else {
      const { convertImageToBeadsPw } = await import(`./src/algorithms/pindou-workbench/index.js${PW_MODULE_QUERY}`);
      // 默认走 improved 档（面积平均采样 + 背景 K-means）；要纯上游口径请显式传 profile。
      result = convertImageToBeadsPw(imageData, { ...shared, ...(state.pwOptions || {}) });
    }

    const { grid, unknown } = gridFromPwMatrix(result.matrix, palette);
    applyPwResult({ ...result, grid }, { engine, maxColors, startedAt, unknownCodes: unknown });
    if (options.saveGallery !== false) saveCurrentToGallery();
    setStatus(getGeneratedStatus());
    return true;
  } catch (error) {
    state.lastGenerationError = error.message || String(error);
    setStatus(`PW 算法失败：${state.lastGenerationError}`);
    window.dispatchEvent(new CustomEvent("libms:generation-error", { detail: state.lastGenerationError }));
    console.error("pindou-workbench algorithm generation failed", error);
    return false;
  } finally {
    state.isProcessingImage = false;
    els.processButton.disabled = false;
  }
}

async function processImage(options = {}) {
  // 算法引擎开关：只有显式选到新引擎才走新模块，否则完全落到原有分支。
  if (state.algorithmEngine === "pindou-workbench" || state.algorithmEngine === "hybrid-pw") {
    return processProductionPw(options);
  }
  if (state.algorithmEngine === "bgs") return processProductionBgs(options);
  if (state.generationEngine === "v2.5") return processProductionV2(options);
  if (!state.sourceDataUrl) {
    setStatus("请先上传");
    return false;
  }
  if (state.manualEdited && !options.overwriteApproved) { setStatus("手动修改尚未确认覆盖"); return false; }
  if (state.isProcessingImage) {
    if (options.autoPreview) state.livePreviewPending = true;
    return false;
  }
  state.isProcessingImage = true;
  window.clearTimeout(state.livePreviewTimer);
  setStatus(options.autoPreview ? "预览更新中" : "处理中");
  els.processButton.disabled = true;
  els.processButton.textContent = options.autoPreview ? "预览中..." : "处理中...";

  try {
    if (!state.sourceSafetyChecked) {
      setStatus("本地审查中");
      const safety = await runLocalContentSafetyCheck(state.sourceDataUrl);
      if (!safety.allowed) {
        setStatus("图片疑似违规");
        window.alert("检测到图片可能包含违规内容，无法生成");
        return false;
      }
      state.sourceSafetyChecked = true;
    }
    const originalImage = await loadImage(state.sourceDataUrl);
    const sourceEditor = await import("./services/source-editor-service.js?v=20260916-phase35-source1");
    state.processedSourceDataUrl = sourceEditor.hasSourceTransform(state.sourceTransform)
      ? sourceEditor.renderSourceTransform(originalImage, state.sourceTransform).toDataURL("image/png") : state.sourceDataUrl;
    const image = state.processedSourceDataUrl === state.sourceDataUrl ? originalImage : await loadImage(state.processedSourceDataUrl);
    state.sourceNaturalWidth = image.naturalWidth;
    state.sourceNaturalHeight = image.naturalHeight;
    applyRestoreSizing(image);
    const palette = getCurrentPalette();
    const regionalBlockV2 = els.modeSelect?.value === "regional-block-v2";
    const portraitPremium = els.modeSelect?.value === "portrait-premium" || regionalBlockV2;
    const startedAt = performance.now();
    const rawMaxColors = clamp(Number(els.maxColorsInput?.value || 0), 0, palette.length);
    const targetHeight = getGenerationTargetHeight(image, getGranularity());
    const result = portraitPremium ? rasterizePortraitPremium(image, palette, {
      targetHeight,
      maxColors: rawMaxColors || null,
      autoMaxColors: rawMaxColors === 0,
      simplificationStrength: clamp(Number(els.regionStrengthInput?.value || 60), 0, 100),
      detailProtection: els.detailProtectionSelect?.value || "standard",
      regionalBlockV2,
    }) : rasterizeImage(image, palette, { height: targetHeight });
    let generatedGrid = result.grid;
    const recommendedMaxColors = result.regionAwareReport?.recommendedMaxColors || window.LibmsRegionAwareQuantizer?.recommendMaxColors?.(
      result.width, result.height, generatedGrid.flat().map((color) => color?.rgb || null), 0,
    ) || Math.min(palette.length, 40);
    const effectiveMaxColors = rawMaxColors || recommendedMaxColors;
    const budgetResult = applyFinalPaletteBudget(generatedGrid, effectiveMaxColors, result);
    generatedGrid = budgetResult.grid;
    state.paletteBudget = { mode: rawMaxColors ? "fixed" : "auto", requested: rawMaxColors || null, recommended: recommendedMaxColors, effective: effectiveMaxColors, ...budgetResult.report };
    state.generationOriginalGrid = cloneGrid(generatedGrid);
    state.generationOptimizedGrid = null;
    state.optimizerReport = null;
    state.showingOptimizedGrid = true;
    if (els.patternOptimizerEnabled?.checked && window.LibmsPatternOptimizer?.createPatternOptimizer) {
      const protection = result.protectionMask || createPatternProtectionMask(generatedGrid);
      const optimized = window.LibmsPatternOptimizer.createPatternOptimizer().optimize(generatedGrid, {
        protectionMask: protection,
        cleanupStrength: portraitPremium ? PORTRAIT_PREMIUM.blockCleanup / 100 : 0.22,
        maxComponentSize: portraitPremium ? 3 : 3,
        maxHoleSize: portraitPremium ? 0 : 1,
      });
      state.generationOptimizedGrid = cloneGrid(optimized.grid);
      state.optimizerReport = optimized;
      generatedGrid = optimized.grid;
    }
    state.grid = cloneGrid(generatedGrid);
    state.manualEdited = false;
    state.regionalBlockReport = result.regionalBlockReport ? {
      ...result.regionalBlockReport,
      finalAfterOptimizer: window.LibmsRegionalBlockV2.calculateRegionalBlockMetrics(state.grid, result.regionalBlockMacro),
    } : null;
    if (state.regionalBlockReport) window.getRegionalBlockV2Report = () => state.regionalBlockReport;
    state.width = result.width;
    state.height = result.height;
    state.backgroundDecision = result.backgroundDecision || "";
    state.paletteEngine = result.paletteEngine || null;
    state.paletteLabel = getCurrentPaletteLabel();
    state.stats = calculateStats(state.grid);
    validateCurrentPatternOrThrow(state.grid, effectiveMaxColors);
    if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
      document.body.dataset.generationBaseline = JSON.stringify(window.captureLegacyGenerationBaseline());
      document.body.dataset.generationRuns = String(Number(document.body.dataset.generationRuns || 0) + 1);
    }
    state.structuralDetectionBaseline = {
      grid: cloneGrid(state.grid),
      usedColorCount: state.stats.length,
      quality: window.LibmsPatternQuality?.calculatePatternQualityMetrics?.(state.grid) || null,
      algorithmVersion: result.regionAwareReport?.version || "legacy",
    };
    const transitionAnalyzer = window.LibmsStructuralTransitionAnalyzer;
    state.structuralTransitionReport = result.sourceFeatures && transitionAnalyzer?.detectStructuralTransitions
      ? transitionAnalyzer.detectStructuralTransitions(state.grid, result.sourceFeatures, window.LibmsRegionAwareQuantizer.rgbToOKLab, {
        regionIds: result.regionIds, roles: result.regionRoles, contourLockedMask: result.contourLockedMask,
      }) : null;
    if (state.structuralTransitionReport) {
      window.getStructuralTransitionReport = () => state.structuralTransitionReport;
      window.downloadStructuralDetectionDebug = () => downloadStructuralDetectionDebug(state.grid, result.sourceFeatures, state.structuralTransitionReport);
      console.info("Structural transitions (detection-only; no cells modified)", state.structuralTransitionReport.metrics);
      const baselineCells = state.structuralDetectionBaseline.grid.flat();
      if (state.grid.flat().some((color, i) => color?.code !== baselineCells[i]?.code)) throw new Error("Detection-only modified pattern matrix");
    }
    state.generationQuality = window.LibmsPatternQuality?.calculatePatternQualityMetrics?.(state.grid, {
      baseline: state.generationOriginalGrid,
      protectedMask: result.protectionMask,
    }) || null;
    state.generationMilliseconds = performance.now() - startedAt;
    // 这两行是「上一次实际跑的是谁」的记分牌：legacy 分支以前没写 generationEngineLast，
    // 会让诊断报告在跑过 legacy 之后仍显示 v2.5；算法引擎轴同理必须一起记。
    state.generationEngineLast = "legacy";
    state.algorithmEngineLast = "current";
    if (portraitPremium) console.info("PORTRAIT_PREMIUM V1", {
      milliseconds: Math.round(state.generationMilliseconds * 10) / 10,
      regionAware: result.regionAwareReport,
      before: window.LibmsPatternQuality?.calculatePatternQualityMetrics?.(state.generationOriginalGrid),
      after: state.generationQuality,
    });
    if (state.regionalBlockReport) console.info("REGIONAL_BLOCK_V2 A/B", state.regionalBlockReport);
    state.assemblyHideCellText = false;
    refreshChartUrl();
    updateResultUi();
    updateOptimizationToggle();
    window.dispatchEvent(new CustomEvent("libms:project-result", { detail: window.LibmsWorkspaceBridge?.getResult() }));
    if (options.saveGallery !== false) saveCurrentToGallery();
    setStatus(options.autoPreview ? `${getGeneratedStatus()} · 实时预览` : getGeneratedStatus());
    return true;
  } catch (error) {
    console.error(error);
    setStatus(getProcessErrorMessage(error));
    return false;
  } finally {
    state.isProcessingImage = false;
    els.processButton.disabled = false;
    els.processButton.textContent = "生成图纸";
    if (state.livePreviewPending) {
      state.livePreviewPending = false;
      scheduleLivePreview("继续更新预览");
    }
  }
}

window.compareCurrentAndRegionalBlockV2 = async () => {
  if (!state.sourceDataUrl || state.isProcessingImage) throw new Error("请先上传原图，并等待当前生成结束");
  const originalMode = els.modeSelect.value;
  try {
    els.modeSelect.value = "portrait-premium";
    if (!await processImage({ saveGallery: false })) throw new Error("CURRENT 生成失败");
    const current = { preview: state.previewUrl, actualColors: state.stats.length };
    els.modeSelect.value = "regional-block-v2";
    if (!await processImage({ saveGallery: false })) throw new Error("REGIONAL_BLOCK_V2 生成失败");
    const report = state.regionalBlockReport;
    const comparison = {
      current: { preview: current.preview, actualColors: current.actualColors, metricsOnSameMacro: report?.currentOnSameMacro },
      v2: { preview: state.previewUrl, actualColors: state.stats.length, metrics: report?.finalAfterOptimizer },
      report,
    };
    window.lastRegionalBlockComparison = comparison;
    return comparison;
  } catch (error) {
    els.modeSelect.value = originalMode;
    throw error;
  }
};

function getProcessErrorMessage(error) {
  const message = String(error?.message || error || "");
  if (/decode|load|读取|解码|broken/i.test(message)) return "图片无法读取";
  if (/taint|security|cross-origin|cors/i.test(message)) return "图片权限受限";
  if (/canvas|context|toDataURL/i.test(message)) return "画布生成失败";
  if (/memory|quota|size/i.test(message)) return "图片过大";
  return "处理失败，请换 PNG/JPG";
}

function isImageFile(file) {
  if (file.type) return SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase());
  return /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name || "");
}

function applyRestoreSizing(image) {
  if (state.importMode !== "restore" && state.importMode !== "ocr") return;
  if (!state.restoreAutoSizePending) return;
  state.restoreAutoSizePending = false;
  const naturalWidth = Number(image.naturalWidth || 0);
  const naturalHeight = Number(image.naturalHeight || 0);
  if (naturalWidth < 10 || naturalHeight < 10) return;
  const detectedWidth = detectPixelArtLogicalWidth(image);
  if (detectedWidth) {
    syncRangeControls("granularity", detectedWidth, 10, 500);
    return;
  }
  if (naturalWidth <= 500) syncRangeControls("granularity", naturalWidth, 10, 500);
}

function detectPixelArtLogicalWidth(image) {
  const width = Number(image.naturalWidth || 0);
  const height = Number(image.naturalHeight || 0);
  if (width < 48 || height < 48 || width > 1800 || height > 1800) return null;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, width, height);

  let data;
  try {
    data = context.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }

  const runLengths = [];
  const rowStep = Math.max(1, Math.floor(height / 52));
  const columnStep = Math.max(1, Math.floor(width / 52));
  for (let y = 0; y < height; y += rowStep) collectPixelRuns(data, width, height, y, true, runLengths);
  for (let x = 0; x < width; x += columnStep) collectPixelRuns(data, width, height, x, false, runLengths);

  const bestCellSize = pickLikelyPixelCellSize(runLengths, Math.min(width, height));
  if (!bestCellSize) return null;
  const logicalWidth = Math.round(width / bestCellSize);
  if (logicalWidth < 10 || logicalWidth > 500) return null;
  const fitError = Math.abs(width / bestCellSize - logicalWidth);
  return fitError <= 0.18 ? logicalWidth : null;
}

function collectPixelRuns(data, width, height, fixed, horizontal, output) {
  const length = horizontal ? width : height;
  let previous = "";
  let runLength = 0;

  for (let index = 0; index < length; index += 1) {
    const x = horizontal ? index : fixed;
    const y = horizontal ? fixed : index;
    const key = getQuantizedPixelKey(data, (y * width + x) * 4);
    if (index === 0) {
      previous = key;
      runLength = 1;
      continue;
    }
    if (key === previous) {
      runLength += 1;
      continue;
    }
    if (runLength >= 3 && runLength <= 96) output.push(runLength);
    previous = key;
    runLength = 1;
  }
  if (runLength >= 3 && runLength <= 96) output.push(runLength);
}

function getQuantizedPixelKey(data, index) {
  const alpha = data[index + 3];
  if (alpha < 24) return "t";
  const bucket = 10;
  return [
    Math.round(data[index] / bucket),
    Math.round(data[index + 1] / bucket),
    Math.round(data[index + 2] / bucket),
    alpha > 220 ? 1 : 0,
  ].join(",");
}

function pickLikelyPixelCellSize(runLengths, maxDimension) {
  if (runLengths.length < 18) return null;
  const scores = new Map();
  const maxCell = Math.min(96, Math.floor(maxDimension / 10));
  for (let cell = 3; cell <= maxCell; cell += 1) {
    let score = 0;
    for (const run of runLengths) {
      const multiple = Math.max(1, Math.round(run / cell));
      const expected = multiple * cell;
      const error = Math.abs(run - expected);
      const tolerance = Math.max(1, cell * 0.08);
      if (error <= tolerance) score += Math.min(3, multiple) * Math.sqrt(cell);
    }
    if (score > 0) scores.set(cell, score);
  }

  let bestCell = 0;
  let bestScore = 0;
  scores.forEach((score, cell) => {
    if (score > bestScore || (score === bestScore && cell > bestCell)) {
      bestScore = score;
      bestCell = cell;
    }
  });

  return bestScore >= 80 ? bestCell : null;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法解码或读取"));
    image.src = src;
  });
}

async function scanReadyMadePattern(file, gridWidth, gridHeight) {
  const dataUrl = await readFileAsDataUrl(file);
  const safety = await runLocalContentSafetyCheck(dataUrl);
  if (!safety.allowed) {
    window.alert("检测到图片可能包含违规内容，无法生成");
    throw new Error("blocked image");
  }

  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas context unavailable");

  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const cellPixelWidth = canvas.width / gridWidth;
  const cellPixelHeight = canvas.height / gridHeight;
  const rawMatrix = [];

  for (let rowIndex = 0; rowIndex < gridHeight; rowIndex += 1) {
    const row = [];
    for (let colIndex = 0; colIndex < gridWidth; colIndex += 1) {
      const centerX = clamp(Math.floor((colIndex + 0.5) * cellPixelWidth), 0, canvas.width - 1);
      const centerY = clamp(Math.floor((rowIndex + 0.5) * cellPixelHeight), 0, canvas.height - 1);
      const pixel = context.getImageData(centerX, centerY, 1, 1).data;
      if (pixel[3] < 24 || isNearWhiteRgb(pixel)) {
        row.push(null);
      } else {
        row.push(rgbToHex([pixel[0], pixel[1], pixel[2]]));
      }
    }
    rawMatrix.push(row);
  }

  const simplified = sanitizeAndSimplifyDirectColors(rawMatrix, {
    tolerance: DIRECT_PATTERN_COLOR_TOLERANCE,
    minCount: DIRECT_PATTERN_MIN_COLOR_COUNT,
  });

  state.grid = simplified.grid;
  state.width = gridWidth;
  state.height = gridHeight;
  state.stats = simplified.stats;
  state.sourceDataUrl = dataUrl;
  state.sourceName = file.name || "direct-pattern";
  state.sourceSafetyChecked = true;
  state.paletteLabel = `直接拼-C色号-${simplified.stats.length}色`;
  state.backgroundDecision = `已合并相似色，过滤 ${simplified.removedCount} 个杂色格`;
  state.assemblyHideCellText = true;

  if (els.sourcePreview) {
    els.sourcePreview.src = dataUrl;
    els.sourcePreview.hidden = false;
  }
  els.uploadZone?.classList.add("has-image");
  refreshChartUrl();
  updateResultUi();
  saveCurrentToGallery();
  setStatus("已扫描，可开始拼");
}

function sanitizeAndSimplifyDirectColors(rawMatrix, options = {}) {
  const tolerance = options.tolerance ?? DIRECT_PATTERN_COLOR_TOLERANCE;
  const minCount = options.minCount ?? DIRECT_PATTERN_MIN_COLOR_COUNT;
  const clusters = [];
  const clusterMatrix = rawMatrix.map((row) =>
    row.map((hexColor) => {
      if (!hexColor) return null;
      const rgbValue = hexToRgb(hexColor);
      if (isNearWhiteRgb(rgbValue)) return null;
      let clusterIndex = clusters.findIndex((cluster) => getColorDistance(cluster.rgb, rgbValue) <= tolerance);
      if (clusterIndex < 0) {
        clusterIndex =
          clusters.push({
            sum: [0, 0, 0],
            rgb: [...rgbValue],
            count: 0,
          }) - 1;
      }
      const cluster = clusters[clusterIndex];
      cluster.sum[0] += rgbValue[0];
      cluster.sum[1] += rgbValue[1];
      cluster.sum[2] += rgbValue[2];
      cluster.count += 1;
      cluster.rgb = cluster.sum.map((value) => value / cluster.count);
      return clusterIndex;
    }),
  );

  let keptClusters = clusters
    .map((cluster, index) => ({
      index,
      count: cluster.count,
      hex: rgbToHex(cluster.rgb),
      rgb: cluster.rgb.map((value) => Math.round(clamp(value, 0, 255))),
    }))
    .filter((cluster) => cluster.count >= minCount);

  if (!keptClusters.length && clusters.length) {
    const largest = clusters
      .map((cluster, index) => ({ index, count: cluster.count, hex: rgbToHex(cluster.rgb), rgb: cluster.rgb }))
      .sort((a, b) => b.count - a.count)[0];
    keptClusters = [
      {
        ...largest,
        rgb: largest.rgb.map((value) => Math.round(clamp(value, 0, 255))),
      },
    ];
  }

  keptClusters.sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
  const colorByCluster = new Map();
  const stats = keptClusters.map((cluster, index) => {
    const color = colorFromHex(`C${index + 1}`, cluster.hex, cluster.count);
    colorByCluster.set(cluster.index, color);
    return color;
  });

  let removedCount = 0;
  const grid = clusterMatrix.map((row) =>
    row.map((clusterIndex) => {
      if (clusterIndex === null) return null;
      const color = colorByCluster.get(clusterIndex);
      if (!color) {
        removedCount += 1;
        return null;
      }
      return cloneColor(color);
    }),
  );

  return { grid, stats, removedCount };
}

function extractAndCountColors(rawMatrix) {
  const colorCounts = new Map();
  for (const row of rawMatrix) {
    for (const hexColor of row) {
      if (!hexColor) continue;
      colorCounts.set(hexColor, (colorCounts.get(hexColor) || 0) + 1);
    }
  }
  return [...colorCounts.entries()]
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
}

function getColorDistance(rgb1, rgb2) {
  return Math.hypot(rgb1[0] - rgb2[0], rgb1[1] - rgb2[1], rgb1[2] - rgb2[2]);
}

function colorFromHex(code, hex, count = 0) {
  return {
    code,
    hex,
    rgb: hexToRgb(hex),
    sourceHex: hex,
    count,
  };
}

function isNearWhiteRgb(pixel) {
  const red = pixel[0];
  const green = pixel[1];
  const blue = pixel[2];
  return red >= 248 && green >= 248 && blue >= 248;
}

function getGenerationTargetHeight(image, width) {
  if (state.aspectRatioLocked && image.naturalWidth) return clamp(Math.round(width * image.naturalHeight / image.naturalWidth), 10, 500);
  return clamp(Math.round(state.targetHeight || width), 10, 500);
}

function rasterizePortraitPremium(image, palette, regionOptions = {}) {
  const width = getGranularity();
  const ratio = image.naturalWidth ? image.naturalHeight / image.naturalWidth : 1;
  const height = regionOptions.targetHeight ?? Math.max(1, Math.min(500, Math.round(width * ratio)));
  const scale = 3;
  const sampleWidth = width * scale;
  const sampleHeight = height * scale;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas context unavailable");
  canvas.width = sampleWidth; canvas.height = sampleHeight;
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const sourcePixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const preprocessor = window.LibmsPortraitPreprocessor;
  const structure = window.LibmsStructureAnalyzer;
  if (!preprocessor?.preprocessPortrait || !structure?.buildEdgeImportanceMap) {
    throw new Error("精品人像模块尚未加载，请刷新页面后重试");
  }
  const stylized = window.LibmsPixelReadyStylizer?.stylizePixelReady
    ? window.LibmsPixelReadyStylizer.stylizePixelReady(sourcePixels, sampleWidth, sampleHeight, {
      mode: "pixel_ready",
      strength: 35,
      shadowSimplification: 55,
      regionMergeStrength: 40,
      targetGridWidth: width,
      targetGridHeight: height,
      edgeProtection: true,
    })
    : { pixels: sourcePixels };
  const prepared = preprocessor.preprocessPortrait(stylized.pixels, sampleWidth, sampleHeight, PORTRAIT_PREMIUM);
  const edgeMap = structure.buildEdgeImportanceMap(prepared.pixels, sampleWidth, sampleHeight);
  const detailMask = structure.buildDetailProtectionMask(edgeMap, prepared.pixels, sampleWidth, sampleHeight, {
    edgeThreshold: 0.56 - (PORTRAIT_PREMIUM.detailPreservation + PORTRAIT_PREMIUM.outlineStrength) / 1000,
  });

  // Keep the established background detector on the final grid resolution.
  const smallCanvas = document.createElement("canvas");
  const smallContext = smallCanvas.getContext("2d", { willReadFrequently: true });
  smallCanvas.width = width; smallCanvas.height = height;
  smallContext.drawImage(image, 0, 0, width, height);
  const smallPixels = smallContext.getImageData(0, 0, width, height).data;
  const background = getBackgroundMask(smallPixels, width, height);
  const highResolutionBackground = getBackgroundMask(prepared.pixels, sampleWidth, sampleHeight);
  const highBackgroundMask = highResolutionBackground.mask;
  const grid = Array.from({ length: height }, () => Array(width).fill(null));
  const gridEdgeMap = new Float32Array(width * height);
  const protectionMask = new Uint8Array(width * height);
  const semanticMap = new Array(width * height).fill("subject");
  const sampledRgbGrid = new Array(width * height).fill(null);
  const originalSourceRgbGrid = new Array(width * height).fill(null);
  const samplingProvenance = new Array(width * height).fill(null);
  const paletteEngine = getPaletteEngine(palette);

  for (let gy = 0; gy < height; gy += 1) for (let gx = 0; gx < width; gx += 1) {
    const gridIndex = gy * width + gx;
    let sumR = 0; let sumG = 0; let sumB = 0; let originalR = 0; let originalG = 0; let originalB = 0; let originalWeight = 0; let weightSum = 0; let foregroundSamples = 0; let alphaSum = 0; let skin = 0; let edge = 0; let protectedCount = 0;
    const bins = new Map();
    for (let sy = 0; sy < scale; sy += 1) for (let sx = 0; sx < scale; sx += 1) {
      const i = (gy * scale + sy) * sampleWidth + gx * scale + sx; const p = i * 4;
      const alpha = prepared.pixels[p + 3];
      if (alpha < 24 || highBackgroundMask?.[i]) continue;
      const weight = alpha / 255;
      const r = prepared.pixels[p]; const g = prepared.pixels[p + 1]; const b = prepared.pixels[p + 2];
      const originalAlpha = sourcePixels[p + 3] / 255;
      if (originalAlpha >= 0.094) { originalR += sourcePixels[p] * originalAlpha; originalG += sourcePixels[p + 1] * originalAlpha; originalB += sourcePixels[p + 2] * originalAlpha; originalWeight += originalAlpha; }
      sumR += r * weight; sumG += g * weight; sumB += b * weight; weightSum += weight; foregroundSamples += 1; alphaSum += alpha; skin += prepared.skinMask[i] * weight; edge = Math.max(edge, edgeMap[i]); protectedCount += detailMask[i];
      const key = `${r >> 5},${g >> 5},${b >> 5}`;
      const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bin.count += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight; bins.set(key, bin);
    }
    const foregroundCoverage = weightSum / (scale * scale);
    if (!weightSum || foregroundCoverage < 0.16) continue;
    const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
    const average = [sumR / weightSum, sumG / weightSum, sumB / weightSum];
    const dominantRgb = [dominant.r / dominant.count, dominant.g / dominant.count, dominant.b / dominant.count];
    const dominance = dominant.count / weightSum;
    // Strong boundaries favor a real local color instead of creating a gray average.
    const smoothing = PORTRAIT_PREMIUM.gradientSmoothing / 100;
    const useDominant = edge > 0.24 + smoothing * 0.08 || dominance >= 0.45 + smoothing * 0.08;
    const sample = useDominant ? dominantRgb : average;
    const skinScore = skin / weightSum;
    const max = Math.max(...sample); const min = Math.min(...sample); const saturation = max ? (max - min) / max : 0;
    const neutralScore = 1 - clamp(saturation / 0.2, 0, 1);
    const warmRedScore = clamp((sample[0] - Math.max(sample[1], sample[2]) - 10) / 55, 0, 1) * (1 - skinScore);
    const region = skinScore > 0.34 ? "skin" : neutralScore > 0.62 ? "neutral" : warmRedScore > 0.45 ? "warm-red" : "subject";
    sampledRgbGrid[gridIndex] = sample;
    originalSourceRgbGrid[gridIndex] = originalWeight ? [originalR / originalWeight, originalG / originalWeight, originalB / originalWeight] : sample;
    samplingProvenance[gridIndex] = {
      sourceSamplingRectangle: { x: gx * scale, y: gy * scale, width: scale, height: scale },
      sourceRgb: average.map((value) => Math.round(value * 100) / 100),
      sourceAlpha: foregroundSamples ? Math.round(alphaSum / foregroundSamples * 100) / 100 : 0,
      foregroundCoverage: Math.round(foregroundCoverage * 10000) / 10000,
    };
    grid[gy][gx] = cloneColor(nearestColor(sample[0], sample[1], sample[2], palette, {
      importance: Math.max(0.55, edge), region, protected: protectedCount > 0, skinScore, neutralScore, warmRedScore,
    }));
    gridEdgeMap[gridIndex] = edge; protectionMask[gridIndex] = protectedCount > 0 || edge > 0.55 ? 1 : 0; semanticMap[gridIndex] = region;
  }
  let finalGrid = grid;
  let regionAwareReport = null;
  let regionIds = null;
  let regionRoles = null;
  let boundaryRings = null;
  let contourLockedMask = null;
  if (window.LibmsRegionAwareQuantizer?.quantizeRegionAware) {
    const quantized = window.LibmsRegionAwareQuantizer.quantizeRegionAware(sampledRgbGrid, width, height, palette, {
      simplificationStrength: regionOptions.simplificationStrength ?? 60,
      detailProtection: regionOptions.detailProtection || "standard",
      maxColors: regionOptions.maxColors,
      autoMaxColors: regionOptions.autoMaxColors,
      coverageMap: samplingProvenance.map((item) => item?.foregroundCoverage || 0),
      samplingProvenance,
    });
    finalGrid = quantized.grid;
    regionAwareReport = quantized.report;
    regionIds = quantized.regionIds;
    regionRoles = quantized.roles;
    boundaryRings = quantized.boundaryRings;
    contourLockedMask = quantized.contourLockedMask;
    window.tracePixel = quantized.tracePixel;
    window.traceBeadCode = (code) => quantized.grid.flatMap((row, y) => row.map((color, x) => color?.code === code ? quantized.tracePixel(x, y) : null)).filter(Boolean);
    window.getRegionBoundaryReport = () => quantized.report.boundaryAfter;
    window.getContourDebugArtifacts = () => createContourDebugArtifacts(quantized, sampledRgbGrid, palette, width, height);
    window.downloadContourDebugArtifacts = () => downloadContourDebugArtifacts(window.getContourDebugArtifacts());
    for (let i = 0; i < gridEdgeMap.length; i += 1) gridEdgeMap[i] = Math.max(gridEdgeMap[i], quantized.edgeMap[i] || 0);
  }
  const sourceFeatures = window.LibmsStructuralTransitionAnalyzer?.buildSourceFeatureMap?.(
    originalSourceRgbGrid, width, height, window.LibmsRegionAwareQuantizer.rgbToOKLab, { regionIds },
  ) || null;
  let regionalBlockReport = null;
  let regionalBlockMacro = null;
  if (regionOptions.regionalBlockV2 && sourceFeatures && window.LibmsRegionalBlockV2?.generateRegionalBlockV2) {
    const v2 = window.LibmsRegionalBlockV2.generateRegionalBlockV2(originalSourceRgbGrid, width, height, palette, sourceFeatures, finalGrid, {
      rgbToOKLab: window.LibmsRegionAwareQuantizer.rgbToOKLab,
      oklabToRgb: window.LibmsRegionAwareQuantizer.oklabToRgb,
      enforceMaxPaletteColors: window.LibmsRegionAwareQuantizer.enforceMaxPaletteColors,
      maxColors: regionOptions.maxColors || regionAwareReport?.effectiveMaxColors || null,
      lockedMask: contourLockedMask,
    });
    const currentGrid = finalGrid;
    finalGrid = v2.grid;
    regionalBlockReport = v2.report;
    regionalBlockMacro = v2.macro;
    window.downloadRegionalBlockV2Debug = () => downloadRegionalBlockV2Debug(originalSourceRgbGrid, currentGrid, v2, palette, width, height);
  }
  return { width, height, grid: finalGrid, gridEdgeMap, protectionMask, semanticMap, regionIds, regionRoles, boundaryRings, contourLockedMask, regionAwareReport, regionalBlockReport, regionalBlockMacro, sourceFeatures, samplingProvenance, backgroundDecision: highResolutionBackground.decision || background.decision, paletteEngine: paletteEngine?.getReport?.() || null };
}

function downloadRegionalBlockV2Debug(sourceRgb, currentGrid, v2, palette, width, height) {
  const current = currentGrid.flat(), before = v2.beforeGrid.flat(), final = v2.grid.flat();
  const artifacts = {
    "source.png": createContourDebugCanvas(width, height, (_x, _y, i) => sourceRgb[i]),
    "posterized_source.png": createContourDebugCanvas(width, height, (_x, _y, i) => v2.posterizedRgbGrid[i]),
    "region_palette_preview.png": createContourDebugCanvas(width, height, (_x, _y, i) => v2.localPalettes.get(v2.macro.ids[i])?.primaryPalette[0]?.rgb || null),
    "current_clean_preview.png": createContourDebugCanvas(width, height, (_x, _y, i) => current[i]?.rgb),
    "before_block_consolidation.png": createContourDebugCanvas(width, height, (_x, _y, i) => before[i]?.rgb),
    "after_block_consolidation.png": createContourDebugCanvas(width, height, (_x, _y, i) => final[i]?.rgb),
    "final_clean_preview.png": createContourDebugCanvas(width, height, (_x, _y, i) => final[i]?.rgb),
  };
  Object.entries(artifacts).forEach(([name, dataUrl]) => downloadUrl(dataUrl, name));
  const chart = renderBeadPattern({ matrix: v2.grid, stats: calculateStats(v2.grid), preset: "PATTERN_EXPORT", cell: getDownloadCellSize(), margin: 88, minLongSide: EXPORT_MIN_LONG_SIDE });
  downloadUrl(chart.toDataURL("image/png"), "final_pattern.png");
}

function downloadStructuralDetectionDebug(grid, features, detection) {
  const { width, height } = features;
  const flat = grid.flat();
  const suspectedCells = new Set(detection.suspectedArtifacts.flatMap((component) => component.pixels));
  const images = {
    "01_final_before_transition_cleanup.png": createContourDebugCanvas(width, height, (_x, _y, i) => flat[i]?.rgb || null),
    "02_source_edges.png": createContourDebugCanvas(width, height, (_x, _y, i) => { const value = Math.round(features.sourceEdgeMap[i] * 255); return features.labs[i] ? [value, value, value] : null; }),
    "03_structural_evidence.png": createContourDebugCanvas(width, height, (_x, _y, i) => features.labs[i] ? [Math.round(detection.structuralEvidenceMap[i] * 255), 20, 40] : null),
    "04_unsupported_transitions.png": createContourDebugCanvas(width, height, (_x, _y, i) => detection.unsupportedTransitionMap[i] ? "#ff1744" : flat[i]?.rgb || null),
    "05_suspected_artifact_components.png": createContourDebugCanvas(width, height, (_x, _y, i) => suspectedCells.has(i) ? "#ff1744" : flat[i]?.rgb || null),
  };
  Object.entries(images).forEach(([name, dataUrl]) => downloadUrl(dataUrl, name));
  downloadBlob(new Blob([JSON.stringify({ metrics: detection.metrics, suspectedArtifacts: detection.suspectedArtifacts, unsupportedTransitions: detection.unsupportedTransitions }, null, 2)], { type: "application/json" }), "structural_detection.json");
}

function createContourDebugCanvas(width, height, paint) {
  const scale = Math.max(3, Math.min(8, Math.floor(832 / Math.max(width, height)))); const canvas = document.createElement("canvas"); const context = canvas.getContext("2d");
  canvas.width = width * scale; canvas.height = height * scale; context.imageSmoothingEnabled = false; context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const fill = paint(x, y, y * width + x); if (!fill) continue; context.fillStyle = Array.isArray(fill) ? `rgb(${fill.join(",")})` : fill; context.fillRect(x * scale, y * scale, scale, scale); }
  return canvas.toDataURL("image/png");
}

function createContourDebugArtifacts(quantized, sampledRgbGrid, palette, width, height) {
  const flat = quantized.grid.flat(); const rings = quantized.boundaryRings; const debug = quantized.contourDebug; const contourSet = new Set(debug.sequences.flat()); const locked = quantized.contourLockedMask; const paletteByCode = new Map(palette.map((color) => [color.code, color]));
  const segmentColors = new Map(); debug.segments.forEach((segment, index) => segment.indices.forEach((i) => segmentColors.set(i, `hsl(${index * 67 % 360} 78% 52%)`)));
  const trace = debug.sequences.flat().map((index) => quantized.tracePixel(index % width, Math.floor(index / width)));
  return {
    "contour_trace.json": JSON.stringify(trace, null, 2),
    "01_foreground_mask.png": createContourDebugCanvas(width, height, (_x, _y, i) => sampledRgbGrid[i] ? "#111111" : null),
    "02_outer_contour.png": createContourDebugCanvas(width, height, (_x, _y, i) => contourSet.has(i) ? "#ff1744" : sampledRgbGrid[i] ? "#e8e8e8" : null),
    "03_contour_band.png": createContourDebugCanvas(width, height, (_x, _y, i) => rings[i] === 0 ? "#ef233c" : rings[i] === 1 ? "#ff9f1c" : rings[i] === 2 ? "#ffd166" : sampledRgbGrid[i] ? "#eeeeee" : null),
    "04_interior_reference_colors.png": createContourDebugCanvas(width, height, (_x, _y, i) => debug.interiorReferences[i]?.lab ? window.LibmsRegionAwareQuantizer.oklabToRgb(debug.interiorReferences[i].lab) : null),
    "05_contour_segments.png": createContourDebugCanvas(width, height, (_x, _y, i) => segmentColors.get(i) || (sampledRgbGrid[i] ? "#eeeeee" : null)),
    "06_raw_contour_palette.png": createContourDebugCanvas(width, height, (_x, _y, i) => contourSet.has(i) ? paletteByCode.get(debug.rawCodes[i])?.rgb : null),
    "07_contour_runs_before.png": createContourDebugCanvas(width, height, (_x, _y, i) => contourSet.has(i) ? paletteByCode.get(debug.rawCodes[i])?.rgb : null),
    "08_contour_runs_after.png": createContourDebugCanvas(width, height, (_x, _y, i) => contourSet.has(i) ? flat[i]?.rgb : null),
    "09_locked_contour.png": createContourDebugCanvas(width, height, (_x, _y, i) => locked[i] === 1 ? "#00a878" : locked[i] === 2 ? "#7ae582" : sampledRgbGrid[i] ? "#eeeeee" : null),
    "10_final_max38.png": createContourDebugCanvas(width, height, (_x, _y, i) => flat[i]?.rgb || null),
  };
}

function downloadContourDebugArtifacts(artifacts) {
  Object.entries(artifacts).forEach(([name, value]) => {
    if (name.endsWith(".json")) downloadBlob(new Blob([value], { type: "application/json" }), name);
    else downloadUrl(value, name);
  });
}

function rasterizeImage(image, palette, dimensions = {}) {
  const width = getGranularity();
  const ratio = image.naturalWidth ? image.naturalHeight / image.naturalWidth : 1;
  const height = dimensions.height ?? Math.max(1, Math.min(500, Math.round(width * ratio)));
  const mode = els.modeSelect?.value || "dominant";
  const threshold = getSimilarityThreshold();

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas context unavailable");
  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = mode !== "palette";
  context.imageSmoothingQuality = mode === "smooth" ? "high" : "medium";
  context.drawImage(image, 0, 0, width, height);

  const pixels = context.getImageData(0, 0, width, height).data;
  const background = getBackgroundMask(pixels, width, height);
  const backgroundMask = background.mask;
  const paletteEngine = getPaletteEngine(palette);
  const grid = Array.from({ length: height }, () => Array(width).fill(null));
  if (mode === "dither") {
    const ditherGrid = ditherPixels(pixels, width, height, palette, threshold, backgroundMask);
    return {
      width,
      height,
      grid: ditherGrid,
      backgroundDecision: background.decision,
      paletteEngine: paletteEngine?.getReport?.() || null,
    };
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = pixels[index + 3];
      if (alpha < 24 || backgroundMask?.[y * width + x]) {
        grid[y][x] = null;
        continue;
      }
      const [red, green, blue] = normalizePixel(
        pixels[index],
        pixels[index + 1],
        pixels[index + 2],
        threshold,
        mode,
      );
      grid[y][x] = cloneColor(nearestColor(red, green, blue, palette, {
        importance: backgroundMask?.[y * width + x] ? 0.2 : 0.65,
        region: backgroundMask?.[y * width + x] ? "background" : "subject",
      }));
    }
  }

  return {
    width,
    height,
    grid,
    backgroundDecision: background.decision,
    paletteEngine: paletteEngine?.getReport?.() || null,
  };
}

function getGeneratedStatus() {
  if (state.backgroundDecision === "auto-removed") return "已生成 · 已智能去背景";
  if (state.backgroundDecision === "auto-kept") return "已生成 · 已保留完整背景";
  if (state.backgroundDecision === "force-removed") return "已生成 · 已强制去背景";
  return "已生成";
}

function getBackgroundMode() {
  return els.backgroundModeSelect?.value || "auto";
}

function getBackgroundMask(pixels, width, height) {
  if (state.importMode === "restore" || state.importMode === "ocr") {
    return { mask: null, decision: "kept" };
  }

  const mode = getBackgroundMode();
  if (mode === "keep") {
    return { mask: null, decision: "kept" };
  }

  const analysis = analyzeConnectedBackground(pixels, width, height);
  if (mode === "remove") {
    return {
      mask: analysis.maskedRatio > 0 ? analysis.mask : null,
      decision: analysis.maskedRatio > 0 ? "force-removed" : "kept",
    };
  }

  if (analysis.shouldRemove) {
    return { mask: analysis.mask, decision: "auto-removed" };
  }

  return { mask: null, decision: "auto-kept" };
}

function analyzeConnectedBackground(pixels, width, height) {
  const cornerAnalysis = getCornerBackgroundAnalysis(pixels, width, height);
  const reference = cornerAnalysis.reference;
  const rawMask = reference ? createConnectedBackgroundMask(pixels, width, height, reference) : null;
  const protectionMask = reference ? createForegroundProtectionMask(pixels, width, height, reference) : null;
  const mask = reference
    ? createConnectedBackgroundMask(pixels, width, height, reference, protectionMask)
    : null;
  const maskedCount = mask ? countMask(mask) : 0;
  const rawMaskedCount = rawMask ? countMask(rawMask) : 0;
  const total = Math.max(1, width * height);
  const maskedRatio = maskedCount / total;
  const rawMaskedRatio = rawMaskedCount / total;
  const edgeStats = reference
    ? getEdgeBackgroundStats(pixels, width, height, reference)
    : { edgeMatchRatio: 0, cornerMatchRatio: 0 };
  const refBrightness = reference ? getBrightness(reference) : 0;
  const refChroma = reference ? getChroma(reference) : 255;
  const lightNeutralReference = refBrightness >= 188 && refChroma <= 64;
  const softPlainReference =
    refBrightness >= 174 &&
    refChroma <= 88 &&
    cornerAnalysis.matchingCorners >= 4 &&
    cornerAnalysis.cornerSpread <= 42 &&
    edgeStats.edgeMatchRatio >= 0.78 &&
    rawMaskedRatio <= 0.82;
  const removableReference = lightNeutralReference || softPlainReference;
  const shouldRemove =
    removableReference &&
    cornerAnalysis.matchingCorners >= 3 &&
    cornerAnalysis.cornerSpread <= 58 &&
    edgeStats.edgeMatchRatio >= 0.68 &&
    edgeStats.cornerMatchRatio >= 0.74 &&
    rawMaskedRatio >= 0.08 &&
    rawMaskedRatio <= 0.92 &&
    maskedRatio >= 0.02;

  return {
    mask,
    maskedRatio,
    shouldRemove,
  };
}

function createConnectedBackgroundMask(
  pixels,
  width,
  height,
  reference = getCornerBackgroundColor(pixels, width, height),
  protectionMask = null,
) {
  const mask = new Uint8Array(width * height);
  const queue = [];
  const pushIfBackground = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixelIndex = y * width + x;
    if (mask[pixelIndex]) return;
    if (protectionMask?.[pixelIndex]) return;
    const dataIndex = pixelIndex * 4;
    if (!isBackgroundLikePixel(pixels, dataIndex, reference)) return;
    mask[pixelIndex] = 1;
    queue.push(pixelIndex);
  };

  for (let x = 0; x < width; x += 1) {
    pushIfBackground(x, 0);
    pushIfBackground(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    pushIfBackground(0, y);
    pushIfBackground(width - 1, y);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const pixelIndex = queue[head];
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    pushIfBackground(x + 1, y);
    pushIfBackground(x - 1, y);
    pushIfBackground(x, y + 1);
    pushIfBackground(x, y - 1);
  }

  return mask;
}

function createForegroundProtectionMask(pixels, width, height, reference) {
  const anchors = new Uint8Array(width * height);
  let anchorCount = 0;
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const dataIndex = pixelIndex * 4;
    if (!isForegroundAnchorPixel(pixels, dataIndex, reference)) continue;
    anchors[pixelIndex] = 1;
    anchorCount += 1;
  }

  if (!anchorCount) return null;
  return dilateMask(anchors, width, height, getForegroundProtectionRadius(width, height));
}

function isForegroundAnchorPixel(pixels, index, reference) {
  const alpha = pixels[index + 3];
  if (alpha < 24) return false;
  return !isBackgroundLikePixel(pixels, index, reference);
}

function getForegroundProtectionRadius(width, height) {
  return Math.round(clamp(Math.min(width, height) * 0.035, 2, 8));
}

function dilateMask(mask, width, height, radius) {
  const output = new Uint8Array(mask.length);
  const offsets = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
    }
  }

  for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
    if (!mask[pixelIndex]) continue;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    offsets.forEach(([dx, dy]) => {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) return;
      output[nextY * width + nextX] = 1;
    });
  }

  return output;
}

function getCornerBackgroundAnalysis(pixels, width, height) {
  const cornerSize = getCornerSampleSize(width, height);
  const corners = [
    getCornerSample(pixels, width, height, 0, 0, cornerSize),
    getCornerSample(pixels, width, height, 1, 0, cornerSize),
    getCornerSample(pixels, width, height, 0, 1, cornerSize),
    getCornerSample(pixels, width, height, 1, 1, cornerSize),
  ].filter(Boolean);
  const lightCorners = corners.filter(
    (corner) => getBrightness(corner) >= 188 && getChroma(corner) <= 70,
  );
  const lightGroup = getBestMatchingColorGroup(lightCorners, 62);
  const allCornerGroup = getBestMatchingColorGroup(corners, 54);
  const bestGroup = lightGroup.length >= 3 ? lightGroup : allCornerGroup;
  const reference = bestGroup.length ? averageRgb(bestGroup) : null;
  const cornerSpread = reference
    ? Math.max(...bestGroup.map((corner) => rgbDistance(corner, reference)))
    : Infinity;

  return {
    reference,
    matchingCorners: bestGroup.length,
    cornerSpread,
  };
}

function getCornerSample(pixels, width, height, right, bottom, size) {
  const samples = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sampleX = right ? width - 1 - x : x;
      const sampleY = bottom ? height - 1 - y : y;
      const index = (sampleY * width + sampleX) * 4;
      if (pixels[index + 3] < 24) continue;
      samples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
    }
  }
  return samples.length ? averageRgb(samples) : null;
}

function getEdgeBackgroundStats(pixels, width, height, reference) {
  let edgeSamples = 0;
  let edgeMatches = 0;
  const testPixel = (x, y) => {
    const index = (y * width + x) * 4;
    edgeSamples += 1;
    if (isBackgroundLikePixel(pixels, index, reference)) edgeMatches += 1;
  };

  for (let x = 0; x < width; x += 1) {
    testPixel(x, 0);
    if (height > 1) testPixel(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    testPixel(0, y);
    if (width > 1) testPixel(width - 1, y);
  }

  const cornerSize = getCornerSampleSize(width, height);
  let cornerSamples = 0;
  let cornerMatches = 0;
  const testCorner = (x, y) => {
    const index = (y * width + x) * 4;
    cornerSamples += 1;
    if (isBackgroundLikePixel(pixels, index, reference)) cornerMatches += 1;
  };

  for (let y = 0; y < cornerSize; y += 1) {
    for (let x = 0; x < cornerSize; x += 1) {
      testCorner(x, y);
      testCorner(width - 1 - x, y);
      testCorner(x, height - 1 - y);
      testCorner(width - 1 - x, height - 1 - y);
    }
  }

  return {
    edgeMatchRatio: edgeSamples ? edgeMatches / edgeSamples : 0,
    cornerMatchRatio: cornerSamples ? cornerMatches / cornerSamples : 0,
  };
}

function getCornerSampleSize(width, height) {
  return Math.max(2, Math.round(Math.min(width, height) * 0.08));
}

function countMask(mask) {
  if (!mask) return 0;
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) count += 1;
  }
  return count;
}

function getBestMatchingColorGroup(colors, maxDistance) {
  let bestGroup = [];
  colors.forEach((color) => {
    const group = colors.filter((candidate) => rgbDistance(color, candidate) <= maxDistance);
    if (group.length > bestGroup.length) bestGroup = group;
  });
  return bestGroup;
}

function averageRgb(colors) {
  return colors
    .reduce((sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]], [0, 0, 0])
    .map((value) => value / colors.length);
}

function rgbDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function getBrightness(rgbValue) {
  return (rgbValue[0] + rgbValue[1] + rgbValue[2]) / 3;
}

function getChroma(rgbValue) {
  return Math.max(rgbValue[0], rgbValue[1], rgbValue[2]) - Math.min(rgbValue[0], rgbValue[1], rgbValue[2]);
}

function getCornerBackgroundColor(pixels, width, height) {
  const cornerSize = getCornerSampleSize(width, height);
  const samples = [];
  const addSample = (x, y) => {
    const index = (y * width + x) * 4;
    if (pixels[index + 3] < 24) return;
    samples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
  };

  for (let y = 0; y < cornerSize; y += 1) {
    for (let x = 0; x < cornerSize; x += 1) {
      addSample(x, y);
      addSample(width - 1 - x, y);
      addSample(x, height - 1 - y);
      addSample(width - 1 - x, height - 1 - y);
    }
  }

  if (!samples.length) return [255, 255, 255];
  return samples
    .reduce((sum, sample) => [sum[0] + sample[0], sum[1] + sample[1], sum[2] + sample[2]], [0, 0, 0])
    .map((value) => value / samples.length);
}

function isBackgroundLikePixel(pixels, index, reference) {
  const alpha = pixels[index + 3];
  if (alpha < 24) return true;
  const red = pixels[index];
  const green = pixels[index + 1];
  const blue = pixels[index + 2];
  const brightness = (red + green + blue) / 3;
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
  const refBrightness = (reference[0] + reference[1] + reference[2]) / 3;
  const distance = Math.hypot(red - reference[0], green - reference[1], blue - reference[2]);

  if (refBrightness > 190) {
    return brightness > 184 && chroma < 52 && distance < 96;
  }
  return distance < 54;
}

function normalizePixel(red, green, blue, threshold, mode) {
  if (mode === "average" || threshold <= 0) return [red, green, blue];
  const divisor = mode === "smooth" ? 3 : 5;
  const step = Math.max(1, Math.round(threshold / divisor));
  return [
    Math.round(red / step) * step,
    Math.round(green / step) * step,
    Math.round(blue / step) * step,
  ];
}

function ditherPixels(pixels, width, height, palette, threshold, backgroundMask = null) {
  const values = new Float32Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    values[i * 3] = pixels[i * 4];
    values[i * 3 + 1] = pixels[i * 4 + 1];
    values[i * 3 + 2] = pixels[i * 4 + 2];
    alpha[i] = pixels[i * 4 + 3];
  }

  const grid = Array.from({ length: height }, () => Array(width).fill(null));
  const addError = (x, y, er, eg, eb, factor) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 3;
    values[offset] += er * factor;
    values[offset + 1] += eg * factor;
    values[offset + 2] += eb * factor;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      if (alpha[pixelIndex] < 24 || backgroundMask?.[pixelIndex]) continue;
      const offset = pixelIndex * 3;
      const [red, green, blue] = normalizePixel(
        clamp(values[offset], 0, 255),
        clamp(values[offset + 1], 0, 255),
        clamp(values[offset + 2], 0, 255),
        threshold,
        "dominant",
      );
      const color = nearestColor(red, green, blue, palette, {
        importance: backgroundMask?.[pixelIndex] ? 0.2 : 0.65,
        region: backgroundMask?.[pixelIndex] ? "background" : "subject",
      });
      grid[y][x] = cloneColor(color);
      const er = red - color.rgb[0];
      const eg = green - color.rgb[1];
      const eb = blue - color.rgb[2];
      addError(x + 1, y, er, eg, eb, 7 / 16);
      addError(x - 1, y + 1, er, eg, eb, 3 / 16);
      addError(x, y + 1, er, eg, eb, 5 / 16);
      addError(x + 1, y + 1, er, eg, eb, 1 / 16);
    }
  }

  return grid;
}

function getFixedBoardSize() {
  const value = els.boardSelect.value;
  if (value === "custom") return null;
  const [width, height] = value.split("x").map(Number);
  return { width, height };
}

function legacyNearestColor(red, green, blue, palette) {
  let best = palette[0];
  let bestDistance = Infinity;
  const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
  const sourceSpread = Math.max(red, green, blue) - Math.min(red, green, blue);
  const sourceGreenBias = green - Math.max(red, blue);

  for (const color of palette) {
    const [cr, cg, cb] = color.rgb;
    const dr = red - cr;
    const dg = green - cg;
    const db = blue - cb;
    const targetLuma = 0.299 * cr + 0.587 * cg + 0.114 * cb;
    const targetSpread = Math.max(cr, cg, cb) - Math.min(cr, cg, cb);
    const targetGreenBias = cg - Math.max(cr, cb);
    let distance =
      dr * dr * 0.95 +
      dg * dg * 1.18 +
      db * db * 1.05 +
      (luma - targetLuma) ** 2 * 0.85;

    if (sourceSpread < 28 && targetSpread > 45) {
      distance += (targetSpread - sourceSpread) ** 2 * 0.45;
    }
    if (sourceGreenBias < 8 && targetGreenBias > 18) {
      distance += targetGreenBias * targetGreenBias * 1.8;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }

  return best;
}

function nearestColor(red, green, blue, palette, context = {}) {
  const engine = getPaletteEngine(palette);
  if (engine) {
    try {
      return engine.match([red, green, blue], context) || legacyNearestColor(red, green, blue, palette);
    } catch (error) {
      if (!paletteEngineWarningShown) {
        console.warn("Professional palette engine failed; using legacy RGB matching.", error);
        paletteEngineWarningShown = true;
      }
    }
  }
  return legacyNearestColor(red, green, blue, palette);
}

function calculateStats(grid) {
  const map = new Map();
  for (const row of grid) {
    for (const color of row) {
      if (!color) continue;
      const existing = map.get(color.code);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(color.code, { ...cloneColor(color), count: 1 });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function applyFinalPaletteBudget(grid, maxColors, context = {}) {
  const quantizer = window.LibmsRegionAwareQuantizer;
  if (!quantizer?.enforceMaxPaletteColors || maxColors == null) return { grid: cloneGrid(grid), report: { finalColorCount: calculateStats(grid).length } };
  const width = grid[0]?.length || 0; const height = grid.length; const matrix = grid.flat().map((color) => color ? cloneColor(color) : null);
  const cells = matrix.map((color) => color ? { rgb: color.rgb, oklab: quantizer.rgbToOKLab(color.rgb) } : null);
  const reduced = quantizer.enforceMaxPaletteColors(matrix, width, height, {
    maxColors,
    cells,
    edgeMap: context.gridEdgeMap,
    regionIds: context.regionIds,
    roles: context.regionRoles,
    boundaryRings: context.boundaryRings,
    lockedMask: context.contourLockedMask,
  });
  return { grid: Array.from({ length: height }, (_, row) => matrix.slice(row * width, (row + 1) * width)), report: reduced.report };
}

function validateCurrentPatternOrThrow(grid, maxColors) {
  const validation = window.LibmsRegionAwareQuantizer?.validateFinalPattern?.(grid, maxColors) || { valid: calculateStats(grid).length <= maxColors, actualColors: calculateStats(grid).length, maxColors };
  if (!validation.valid) throw new Error(`最终颜色校验失败：${validation.actualColors} > ${validation.maxColors}`);
  return validation;
}

function createPatternProtectionMask(grid) {
  const height = grid.length;
  const width = grid[0]?.length || 0;
  const mask = new Array(width * height).fill(false);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = grid[y][x];
      if (!color) continue;
      let strongestEdge = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const neighbor = grid[y + dy]?.[x + dx];
        if (!neighbor) continue;
        strongestEdge = Math.max(strongestEdge, Math.hypot(
          color.rgb[0] - neighbor.rgb[0],
          color.rgb[1] - neighbor.rgb[1],
          color.rgb[2] - neighbor.rgb[2],
        ));
      }
      const luminance = 0.299 * color.rgb[0] + 0.587 * color.rgb[1] + 0.114 * color.rgb[2];
      mask[y * width + x] = strongestEdge >= 58 || luminance <= 34 || luminance >= 244;
    }
  }
  return mask;
}

function updateOptimizationToggle() {
  if (!els.toggleOptimizedButton) return;
  const hasAlternative = Boolean(state.generationOriginalGrid && state.generationOptimizedGrid && state.optimizerReport?.changed);
  els.toggleOptimizedButton.hidden = !hasAlternative;
  els.toggleOptimizedButton.textContent = state.showingOptimizedGrid ? "查看优化前" : "查看优化后";
}

function toggleGeneratedOptimization() {
  if (state.manualEdited) { window.alert("当前图纸已有手动修改。重新生成前不会切换自动优化结果，以免覆盖编辑。 "); return; }
  const next = state.showingOptimizedGrid ? state.generationOriginalGrid : state.generationOptimizedGrid;
  if (!next) return;
  state.showingOptimizedGrid = !state.showingOptimizedGrid;
  state.grid = cloneGrid(next);
  state.stats = calculateStats(state.grid);
  refreshChartUrl();
  updateResultUi();
  updateOptimizationToggle();
  window.dispatchEvent(new CustomEvent("libms:project-result", { detail: window.LibmsWorkspaceBridge?.getResult() }));
  setStatus(state.showingOptimizedGrid ? "正在查看优化后" : "正在查看优化前");
}

function refreshChartUrl() {
  const maxSide = Math.max(state.width, state.height);
  const cell = maxSide > 260 ? 4 : maxSide > 160 ? 6 : 8;
  state.previewRenderCell = cell;
  try {
    const previewCanvas = renderBeadPattern({ matrix: state.grid, stats: state.stats, preset: "PREVIEW_CLEAN", cell });
    const canvas = renderBeadPattern({ matrix: state.grid, stats: state.stats, preset: "PATTERN_EXPORT", cell: maxSide > 160 ? 10 : maxSide > 90 ? 18 : 30, margin: 50 });
    state.previewUrl = previewCanvas.toDataURL("image/png");
    state.chartUrl = canvas.toDataURL("image/png");
  } catch (error) {
    console.warn("Chart preview fallback", error);
    const fallbackUrl = createLightPreviewCanvas(state.grid).toDataURL("image/png");
    state.previewUrl = fallbackUrl;
    state.chartUrl = fallbackUrl;
  }
}

function createLightPreviewCanvas(grid) {
  const rows = grid.length;
  const columns = grid[0]?.length || 1;
  const cell = Math.max(2, Math.min(10, Math.floor(900 / Math.max(columns, rows))));
  const padding = 16;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas context unavailable");
  canvas.width = columns * cell + padding * 2;
  canvas.height = rows * cell + padding * 2;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const color = grid[y][x];
      context.fillStyle = color ? rgb(color) : "#f3eadb";
      context.fillRect(padding + x * cell, padding + y * cell, cell, cell);
    }
  }
  return canvas;
}

function createGalleryThumbnailCanvas(grid) {
  const rows = grid.length;
  const columns = grid[0]?.length || 1;
  const cell = Math.max(2, Math.min(8, Math.floor(420 / Math.max(columns, rows))));
  const padding = 12;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas context unavailable");
  canvas.width = columns * cell + padding * 2;
  canvas.height = rows * cell + padding * 2;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const color = grid[y][x];
      context.fillStyle = color ? rgb(color) : "#f6f6f3";
      context.fillRect(padding + x * cell, padding + y * cell, cell, cell);
    }
  }
  return canvas;
}

function saveCurrentToGallery() {
  if (!state.grid.length || !els.generatedGallery) return;
  const total = state.stats.reduce((sum, item) => sum + item.count, 0);
  const title = buildGalleryTitle();
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    image: createGalleryThumbnailCanvas(state.grid).toDataURL("image/png"),
    gridData: serializeGridForLibrary(state.grid),
    paletteKey: getActivePaletteKeyForStorage(),
    width: state.width,
    height: state.height,
    colors: state.stats.length,
    beads: total,
    palette: getChartPaletteLabel(),
    size: formatFinishedSize(state.width, state.height),
    createdAt: new Date().toISOString(),
    generation: {
      algorithmVersion: window.LibmsRegionAwareQuantizer?.REGION_AWARE_VERSION || "legacy",
      maxColorsMode: state.paletteBudget?.mode || "auto",
      maxColors: state.paletteBudget?.effective || null,
      actualColors: state.stats.length,
    },
  };
  const items = [item, ...getGeneratedGallery().filter((entry) => entry.title !== title)].slice(
    0,
    MAX_GALLERY_ITEMS,
  );
  persistGeneratedGallery(items);
  renderGeneratedGallery();
  renderEditorLibraryOptions();
}

function buildGalleryTitle() {
  const schemeName = getSchemeName();
  if (schemeName) return schemeName;
  const base = state.sourceName.replace(/\.[^.]+$/, "").trim();
  if (base && base !== "blank-board") return base;
  return `拼豆图纸 ${state.width}x${state.height}`;
}

function getGeneratedGallery() {
  try {
    const raw = localStorage.getItem(GALLERY_STORAGE_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function persistGeneratedGallery(items) {
  let next = items;
  while (next.length) {
    try {
      localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(next));
      return;
    } catch {
      next = next.slice(0, -1);
    }
  }
  localStorage.removeItem(GALLERY_STORAGE_KEY);
}

function getActivePaletteKeyForStorage() {
  if (els.editorModal?.open && els.editorPaletteSelect?.value) return els.editorPaletteSelect.value;
  return getCurrentPaletteKey();
}

function serializeGridForLibrary(grid) {
  return grid
    .map((row) => row.map((color) => (color ? `${color.code}|${rgbToHex(color.rgb)}` : ".")).join(","))
    .join(";");
}

function deserializeGridFromLibrary(item) {
  if (!item?.gridData) return null;
  const rows = String(item.gridData)
    .split(";")
    .map((row) =>
      row.split(",").map((token) => {
        if (!token || token === ".") return null;
        const [code, hex] = token.split("|");
        if (hex && /^#[0-9a-f]{6}$/i.test(hex)) return colorFromHex(code, hex);
        return cloneColor(findColorByCode(code, item.paletteKey));
      }),
    );
  return rows.length && rows[0]?.length ? rows : null;
}

function findColorByCode(code, preferredPaletteKey = "") {
  const normalized = normalizeMardCode(code);
  const palettes = [
    PALETTES[preferredPaletteKey],
    getEditorPalette(),
    getCurrentPalette(),
    ...Object.values(PALETTES),
  ].filter(Boolean);
  for (const palette of palettes) {
    const match = palette.find((color) => normalizeMardCode(color.code) === normalized);
    if (match) return match;
  }
  return { code, hex: "#999999", rgb: [153, 153, 153] };
}

function renderGeneratedGallery() {
  if (!els.generatedGallery) return;
  const query = (els.gallerySearch?.value || "").trim().toLowerCase();
  const allItems = getGeneratedGallery();
  const items = query
    ? allItems.filter((item) =>
        [item.title, item.size, item.palette, `${item.width}x${item.height}`, `${item.colors}色`]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    : allItems;

  els.generatedGallery.replaceChildren();
  if (els.galleryCount) {
    els.galleryCount.textContent = `${items.length} / ${allItems.length} 张图纸`;
  }
  if (els.galleryEmpty) {
    els.galleryEmpty.hidden = allItems.length > 0;
  }

  for (const item of items) {
    const card = document.createElement("button");
    card.className = "gallery-card";
    card.type = "button";
    card.addEventListener("click", () => openGalleryPreview(item));

    const image = document.createElement("img");
    image.src = item.image;
    image.alt = item.title;
    image.loading = "lazy";

    const overlay = document.createElement("span");
    overlay.className = "gallery-pill";
    overlay.textContent = `${item.width}x${item.height}`;

    const caption = document.createElement("span");
    caption.className = "gallery-caption";
    caption.innerHTML = `<strong>${escapeHtml(item.title)}</strong><small>${item.colors} 色 · ${formatCount(
      item.beads,
    )} 颗 · ${escapeHtml(item.size)}</small>`;

    card.append(image, overlay, caption);
    els.generatedGallery.append(card);
  }
}

function renderEditorLibraryOptions() {
  if (!els.libraryImportSelect) return;
  const currentValue = els.libraryImportSelect.value;
  const items = getGeneratedGallery().filter((item) => item.gridData);
  els.libraryImportSelect.replaceChildren(new Option("从作品库导入", ""));
  for (const item of items) {
    els.libraryImportSelect.append(new Option(`${item.title} · ${item.width}x${item.height}`, item.id));
  }
  if (items.some((item) => item.id === currentValue)) {
    els.libraryImportSelect.value = currentValue;
  }
  updateLibraryImportButton();
}

function openGalleryPreview(item) {
  if (!els.previewModal || !els.modalPreviewImage) return;
  state.previewZoom = 1;
  state.previewModalUsesCurrentGrid = false;
  els.modalPreviewImage.src = item.image;
  els.modalPreviewImage.alt = item.title;
  setPreviewZoom(1);
  els.previewModal.showModal();
}

function clearGeneratedGallery() {
  localStorage.removeItem(GALLERY_STORAGE_KEY);
  if (els.gallerySearch) els.gallerySearch.value = "";
  renderGeneratedGallery();
  renderEditorLibraryOptions();
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char] || char;
  });
}

function renderBeadPattern(options) {
  const policy = window.LibmsRenderPolicy;
  const preset = policy?.RENDER_PRESETS?.[options.preset] || {};
  const cell = options.cell || 30;
  const zoom = options.zoom || 1;
  const showCodes = options.showCodes ?? (preset.showCodes === "auto"
    ? Boolean(policy?.shouldShowBeadCode?.(zoom, cell))
    : preset.showCodes);
  return createChartCanvas(options.matrix, options.stats || calculateStats(options.matrix), {
    ...preset,
    ...options,
    showCodes,
    cell,
  });
}

function createChartCanvas(grid, stats, options = {}) {
  const rows = grid.length;
  const columns = grid[0]?.length || 0;
  const cell = options.cell || 30;
  const showHeader = options.showHeader ?? true;
  const showCoordinates = options.showCoordinates ?? true;
  const showGrid = options.showGrid ?? true;
  const margin = options.margin ?? (showHeader || showCoordinates ? 54 : 0);
  const headerHeight = showHeader ? (options.headerHeight || (options.subtitle ? 196 : 166)) : margin;
  const showCodes = options.showCodes ?? cell >= 22;
  const title = options.title || "里白造物拼豆图纸生成器";
  const paletteLabel = options.paletteLabel || getChartPaletteLabel();
  const totalBeads = stats.reduce((sum, item) => sum + item.count, 0);
  const finishedSize = formatFinishedSize(columns, rows);
  const boardX = margin;
  const boardY = headerHeight;
  const boardWidth = columns * cell;
  const boardHeight = rows * cell;
  const width = Math.max(options.minWidth ?? (showHeader ? 960 : 1), boardWidth + margin * 2);
  const showLegend = options.showLegend ?? true;
  const legendLayout = showLegend ? getLegendLayout(width, stats.length, margin) : null;
  // 图案下方、色块图例上方的用量汇总行（与 doudou-up 的图例表头同构）。
  // 只在出「图纸」时出现：预览类渲染走 showLegend=false，不占任何高度，
  // 布局与旧版逐像素一致，所以 PREVIEW_CLEAN / PREVIEW_EXPORT / ZOOM_DETAIL 不受影响。
  const summaryText = showLegend && stats.length ? `已使用颜色 ${stats.length} 种 / ${formatCount(totalBeads)} 颗` : "";
  const summaryBandHeight = summaryText ? 30 : 0;
  const summaryY = boardY + boardHeight + 46;
  const legendTop = boardY + boardHeight + 54 + summaryBandHeight;
  const height = showLegend
    ? legendTop + legendLayout.rows * legendLayout.itemHeight + 58
    : boardY + boardHeight + (showHeader || showCoordinates ? 46 : margin);
  const outputScale = getCanvasOutputScale(width, height, options.minLongSide);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas context unavailable");
  canvas.width = Math.ceil(width * outputScale);
  canvas.height = Math.ceil(height * outputScale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.scale(outputScale, outputScale);
  context.imageSmoothingEnabled = false;

  context.fillStyle = "#fffdf7";
  context.fillRect(0, 0, width, height);
  if (showHeader) drawChartHeader(context, {
    title,
    paletteLabel,
    totalBeads,
    finishedSize,
    extraInfo: options.subtitle || "",
    width,
    margin,
  });

  context.font = `${cell >= 34 ? 13 : 11}px ${CANVAS_FONT_STACK}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const labelStep = Math.max(columns, rows) <= 30 ? 1 : 5;

  if (showCoordinates) for (let x = 0; x < columns; x += 1) {
    const label = x + 1;
    if (!shouldShowCoordinateLabel(label, 1, columns, labelStep)) continue;
    const cx = boardX + x * cell + cell / 2;
    context.fillStyle = "#69716e";
    context.fillText(label, cx, boardY - 15);
    context.fillText(label, cx, boardY + boardHeight + 18);
  }

  if (showCoordinates) for (let y = 0; y < rows; y += 1) {
    const label = y + 1;
    if (!shouldShowCoordinateLabel(label, 1, rows, labelStep)) continue;
    const cy = boardY + y * cell + cell / 2;
    context.fillStyle = "#69716e";
    context.textAlign = "right";
    context.fillText(label, boardX - 10, cy);
    context.textAlign = "left";
    context.fillText(label, boardX + boardWidth + 10, cy);
    context.textAlign = "center";
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const color = grid[y][x];
      const px = boardX + x * cell;
      const py = boardY + y * cell;
      if (color) {
        context.fillStyle = rgb(color);
        context.fillRect(px, py, cell, cell);
      } else {
        if (state.editorReferenceImage && state.editorReference?.visible !== false) {
          context.fillStyle = "rgba(255, 253, 247, 0.18)";
          context.fillRect(px, py, cell, cell);
        } else {
          drawEmptyCell(context, px, py, cell);
        }
      }
    }
  }
  if (showGrid) drawCountingGrid(context, boardX, boardY, columns, rows, cell);

  if (options.watermark !== false) {
    drawChartWatermark(context, boardX, boardY, boardWidth, boardHeight);
  }

  if (showCodes) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const color = grid[y][x];
        if (!color) continue;
        const px = boardX + x * cell;
        const py = boardY + y * cell;
        context.fillStyle = isDark(color.rgb) ? "#ffffff" : "#1f2422";
        context.font = `900 ${getCodeFontSize(color.code, cell)}px ${CANVAS_FONT_STACK}`;
        context.fillText(color.code, px + cell / 2, py + cell / 2 + 1);
      }
    }
  }

  if (summaryText) {
    context.save();
    // 水平居中：图例框左上/右上角各有一个半径 10 的黑色角点（legendTop-22），
    // 左对齐会正好压在左角点上，居中则与两者都不相交，观感也更像图例表头。
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#111827";
    context.font = `900 16px ${CANVAS_FONT_STACK}`;
    context.fillText(summaryText, width / 2, summaryY);
    context.restore();
  }

  if (showLegend) {
    drawLegendPanel(context, stats, {
      x: margin,
      y: legendTop,
      width: width - margin * 2,
      layout: legendLayout,
    });
  }

  return canvas;
}

function createA4PageCanvas(tile, details) {
  const { pageWidth, pageHeight, marginPx, pageIndex, pageCount, orientation, mirrorLabel } =
    details;
  const headerHeight = 218;
  const footerHeight = 92;
  const labelBand = 34;
  const grid = tile.grid;
  const rows = grid.length;
  const columns = grid[0]?.length || 0;
  const availableWidth = pageWidth - marginPx * 2 - labelBand * 2;
  const availableHeight = pageHeight - marginPx * 2 - headerHeight - footerHeight - labelBand * 2;
  const cell = Math.max(
    14,
    Math.floor(Math.min(availableWidth / Math.max(1, columns), availableHeight / Math.max(1, rows))),
  );
  const boardWidth = columns * cell;
  const boardHeight = rows * cell;
  const boardX = marginPx + labelBand + Math.max(0, (availableWidth - boardWidth) / 2);
  const boardY = marginPx + headerHeight + labelBand;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas context unavailable");
  canvas.width = pageWidth;
  canvas.height = pageHeight;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, pageWidth, pageHeight);
  context.strokeStyle = "rgba(38, 38, 34, 0.3)";
  context.setLineDash([12, 12]);
  context.strokeRect(marginPx + 0.5, marginPx + 0.5, pageWidth - marginPx * 2, pageHeight - marginPx * 2);
  context.setLineDash([]);

  drawLogoMark(context, marginPx, marginPx, 96);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#111827";
  context.font = `900 42px ${CANVAS_FONT_STACK}`;
  context.fillText("里白造物拼豆图纸", marginPx + 118, marginPx + 43);
  context.fillStyle = "#4b5563";
  context.font = `800 24px ${CANVAS_FONT_STACK}`;
  context.fillText(
    `A4打印分版 · 第 ${pageIndex} / ${pageCount} 页 · ${orientation === "landscape" ? "横版" : "竖版"}${mirrorLabel ? ` · ${mirrorLabel}` : ""}`,
    marginPx + 118,
    marginPx + 82,
  );
  context.font = `700 20px ${CANVAS_FONT_STACK}`;
  context.fillText(
    `全图 ${details.fullWidth} x ${details.fullHeight} · 本页列 ${tile.x0 + 1}-${tile.x1} · 行 ${tile.y0 + 1}-${tile.y1} · 边距 ${details.marginMm}mm`,
    marginPx + 118,
    marginPx + 118,
  );

  context.textAlign = "center";
  context.textBaseline = "middle";
  const labelStep = Math.max(columns, rows) <= 30 ? 1 : 5;
  context.font = `700 15px ${CANVAS_FONT_STACK}`;
  for (let x = 0; x < columns; x += 1) {
    const label = tile.x0 + x + 1;
    if (!shouldShowCoordinateLabel(label, tile.x0 + 1, tile.x1, labelStep)) continue;
    const cx = boardX + x * cell + cell / 2;
    context.fillStyle = "#69716e";
    context.fillText(label, cx, boardY - 18);
    context.fillText(label, cx, boardY + boardHeight + 18);
  }
  for (let y = 0; y < rows; y += 1) {
    const label = tile.y0 + y + 1;
    if (!shouldShowCoordinateLabel(label, tile.y0 + 1, tile.y1, labelStep)) continue;
    const cy = boardY + y * cell + cell / 2;
    context.fillStyle = "#69716e";
    context.textAlign = "right";
    context.fillText(label, boardX - 12, cy);
    context.textAlign = "left";
    context.fillText(label, boardX + boardWidth + 12, cy);
    context.textAlign = "center";
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const color = grid[y][x];
      const px = boardX + x * cell;
      const py = boardY + y * cell;
      if (color) {
        context.fillStyle = rgb(color);
        context.fillRect(px, py, cell, cell);
      } else {
        drawEmptyCell(context, px, py, cell);
      }
    }
  }
  drawCountingGrid(context, boardX, boardY, columns, rows, cell);

  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const color = grid[y][x];
      if (!color) continue;
      const px = boardX + x * cell;
      const py = boardY + y * cell;
      context.fillStyle = isDark(color.rgb) ? "#ffffff" : "#1f2422";
      context.font = `900 ${getCodeFontSize(color.code, cell)}px ${CANVAS_FONT_STACK}`;
      context.fillText(color.code, px + cell / 2, py + cell / 2 + 1);
    }
  }

  context.fillStyle = "#4b5563";
  context.font = `700 18px ${CANVAS_FONT_STACK}`;
  context.fillText(
    "虚线框为A4页边距预留区域，请按页面顺序拼接使用。",
    pageWidth / 2,
    pageHeight - marginPx - 28,
  );
  return canvas;
}

function getCodeFontSize(code, cell) {
  const base = Math.floor(cell * (code.length > 3 ? 0.26 : 0.32));
  return Math.max(7, Math.min(16, base));
}

function drawChartHeader(context, details) {
  const logoSize = 88;
  const logoX = details.margin;
  const logoY = 24;
  drawLogoMark(context, logoX, logoY, logoSize);

  const textX = logoX + logoSize + 18;
  const textMaxWidth = Math.max(280, details.width - textX - details.margin - 180);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#111827";
  context.font = `900 30px ${CANVAS_FONT_STACK}`;
  context.fillText("里白造物拼豆图纸", textX, 50, textMaxWidth);
  context.fillStyle = "#4b5563";
  context.font = `800 14px ${CANVAS_FONT_STACK}`;
  context.fillText("LiBai Maker Studio", textX, 73, textMaxWidth);

  context.fillStyle = "#111827";
  context.font = `900 18px ${CANVAS_FONT_STACK}`;
  context.fillText(details.title, textX, 100, textMaxWidth);
  context.fillStyle = "#4b5563";
  context.font = `800 15px ${CANVAS_FONT_STACK}`;
  context.fillText(
    `色号：${details.paletteLabel} · 总计：${formatCount(details.totalBeads)} 颗 · 成品：${details.finishedSize} · 单颗 2.6mm`,
    textX,
    124,
    textMaxWidth,
  );
  if (details.extraInfo) {
    context.fillStyle = "#6b7280";
    context.font = `700 12px ${CANVAS_FONT_STACK}`;
    context.fillText(details.extraInfo, textX, 149, details.width - textX - details.margin);
  }

  context.textAlign = "right";
  context.fillStyle = "rgba(17, 24, 39, 0.52)";
  context.font = `800 14px ${CANVAS_FONT_STACK}`;
  context.fillText("LiBai Maker Studio", details.width - details.margin, 42);

  context.strokeStyle = "rgba(17, 24, 39, 0.16)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(details.margin, details.extraInfo ? 165 : 140);
  context.lineTo(details.width - details.margin, details.extraInfo ? 165 : 140);
  context.stroke();
}

function drawLogoMark(context, x, y, size) {
  context.save();
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = "#ffffff";
  context.fillRect(x, y, size, size);

  const radius = size * 0.17;
  const inner = size * 0.067;
  drawSmoothDonut(context, x + size * 0.33, y + size * 0.32, radius, inner, "#ef1d24");
  drawSmoothDonut(context, x + size * 0.67, y + size * 0.32, radius, inner, "#f5b700");
  drawSmoothDonut(context, x + size * 0.33, y + size * 0.68, radius, inner, "#2cad4f");
  drawSmoothDonut(context, x + size * 0.67, y + size * 0.68, radius, inner, "#0968ee");
  context.restore();
  context.strokeStyle = "#111827";
  context.lineWidth = Math.max(1.5, size * 0.035);
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size / 2 - context.lineWidth / 2, 0, Math.PI * 2);
  context.stroke();
}

function drawSmoothDonut(context, cx, cy, radius, innerRadius, color) {
  context.fillStyle = color;
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(cx, cy, innerRadius, 0, Math.PI * 2);
  context.fill();
}

function drawPixelDonut(context, x, y, size, color) {
  const unit = size / 7;
  const blocks = [
    [2, 0],
    [3, 0],
    [4, 0],
    [1, 1],
    [5, 1],
    [0, 2],
    [1, 2],
    [5, 2],
    [6, 2],
    [0, 3],
    [1, 3],
    [5, 3],
    [6, 3],
    [0, 4],
    [1, 4],
    [5, 4],
    [6, 4],
    [1, 5],
    [5, 5],
    [2, 6],
    [3, 6],
    [4, 6],
  ];
  context.fillStyle = color;
  blocks.forEach(([px, py]) => {
    context.fillRect(x + px * unit, y + py * unit, unit, unit);
  });
}

function drawChartWatermark(context, x, y, width, height) {
  context.save();
  context.globalAlpha = 0.028;
  context.fillStyle = "#111827";
  context.translate(x + width / 2, y + height / 2);
  context.rotate(-Math.PI / 10);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `900 ${Math.max(54, Math.min(170, width / 7))}px ${CANVAS_FONT_STACK}`;
  context.fillText("LiBai Maker Studio", 0, 0);
  context.restore();

  const timestamp = `${getLocalTimestamp()} 客户端本地生成`;
  const antiForgeryCode = getAntiForgeryCode();
  context.save();
  context.globalAlpha = 0.68;
  context.fillStyle = "rgba(17, 24, 39, 0.38)";
  context.textAlign = "right";
  context.textBaseline = "bottom";
  context.font = `800 ${Math.max(7, Math.min(13, width / 100))}px ${CANVAS_FONT_STACK}`;
  const right = x + width - 8;
  const bottom = y + height - 8;
  context.fillText(LOCAL_WATERMARK_TEXT, right, bottom - 18, Math.max(180, width * 0.86));
  context.fillText(`${timestamp} · ${antiForgeryCode}`, right, bottom, Math.max(180, width * 0.86));
  context.restore();
}

function getLocalTimestamp() {
  const date = new Date();
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(
    date.getHours(),
  )}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;
}

function getAntiForgeryCode() {
  const signature = [
    state.sourceName || "local",
    `${state.width}x${state.height}`,
    state.paletteLabel || getCurrentPaletteLabel(),
    state.stats.length,
    state.stats.reduce((sum, item) => sum + item.count, 0),
    new Date().toDateString(),
  ].join("|");
  return `LB-${fnv1aHash(signature)}`;
}

function fnv1aHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(8, "0");
}

function drawLegendPanel(context, stats, options) {
  const { x, y, width, layout } = options;
  const height = Math.max(layout.itemHeight, layout.rows * layout.itemHeight + 28);
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(x, y - 22, width, height);
  context.strokeStyle = "rgba(17, 24, 39, 0.34)";
  context.lineWidth = 1.2;
  context.strokeRect(x + 0.5, y - 22.5, width - 1, height - 1);
  drawCornerDot(context, x, y - 22);
  drawCornerDot(context, x + width, y - 22);
  drawCornerDot(context, x, y - 22 + height);
  drawCornerDot(context, x + width, y - 22 + height);

  context.textAlign = "center";
  context.textBaseline = "middle";
  stats.forEach((item, index) => {
    const col = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const itemX = x + col * layout.itemWidth;
    const itemY = y + row * layout.itemHeight;
    const swatchX = itemX + (layout.itemWidth - layout.swatchSize) / 2;
    const swatchY = itemY;

    context.fillStyle = rgb(item);
    roundedRect(context, swatchX, swatchY, layout.swatchSize, layout.swatchSize, 7);
    context.fill();
    context.strokeStyle = "rgba(17, 24, 39, 0.18)";
    context.stroke();
    context.fillStyle = isDark(item.rgb) ? "#ffffff" : "#111827";
    context.font = `900 ${Math.max(11, Math.floor(layout.swatchSize * 0.29))}px ${CANVAS_FONT_STACK}`;
    context.fillText(item.code, swatchX + layout.swatchSize / 2, swatchY + layout.swatchSize / 2 + 1);

    context.fillStyle = "#111827";
    context.font = `800 12px ${CANVAS_FONT_STACK}`;
    context.fillText(formatCount(item.count), itemX + layout.itemWidth / 2, swatchY + layout.swatchSize + 23);
  });
  context.restore();
}

function drawCornerDot(context, x, y) {
  context.fillStyle = "#000000";
  context.beginPath();
  context.arc(x, y, 10, 0, Math.PI * 2);
  context.fill();
}

function getLegendLayout(width, count, margin) {
  const available = Math.max(1, width - margin * 2);
  const columns = Math.max(1, Math.floor(available / 72));
  const itemWidth = available / columns;
  const rows = Math.max(1, Math.ceil(Math.max(1, count) / columns));
  return {
    columns,
    itemWidth,
    rows,
    itemHeight: 82,
    swatchSize: 46,
  };
}

function getCanvasOutputScale(width, height, minLongSide = 0) {
  if (!minLongSide) return 1;
  return Math.max(1, minLongSide / Math.max(width, height));
}

function formatFinishedSize(columns, rows) {
  return `${formatCm(columns * BEAD_SIZE_CM)} x ${formatCm(rows * BEAD_SIZE_CM)} cm`;
}

function formatCm(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// 站内所有「颗数 / 色数 / 格数」一律不带千分位（与图纸汇总行、工作台统计条一致）。
// 金额不归这里管：pricing.js 的 formatMoney 保留千分位。
function formatCount(value) {
  return new Intl.NumberFormat("zh-CN", { useGrouping: false }).format(value);
}

function roundedRect(context, x, y, width, height, radius) {
  if (context.roundRect) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
}

function drawEmptyCell(context, x, y, size) {
  context.fillStyle = "#fffefa";
  context.fillRect(x, y, size, size);
}

function shouldShowCoordinateLabel(label, startLabel, endLabel, step) {
  return label === startLabel || label === endLabel || label % step === 0;
}

function drawCountingGrid(context, x, y, columns, rows, cell, options = {}) {
  const majorEvery = options.majorEvery || 5;
  const width = columns * cell;
  const height = rows * cell;
  const thinColor = options.thinColor || "rgba(31, 36, 34, 0.26)";
  const majorColor = options.majorColor || "rgba(31, 36, 34, 0.68)";
  const outerColor = options.outerColor || "rgba(17, 24, 39, 0.86)";
  const thinWidth = options.thinWidth || 1;
  const majorWidth = options.majorWidth || (cell >= 22 ? 2.6 : cell >= 10 ? 2 : 1.65);
  const outerWidth = options.outerWidth || Math.max(majorWidth + 0.4, 2.8);

  const drawLine = (x1, y1, x2, y2, lineWidth, strokeStyle) => {
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  };

  context.save();
  context.setLineDash([]);
  for (let column = 0; column <= columns; column += 1) {
    if (column % majorEvery === 0 || column === columns) continue;
    const lineX = x + column * cell + 0.5;
    drawLine(lineX, y, lineX, y + height, thinWidth, thinColor);
  }
  for (let row = 0; row <= rows; row += 1) {
    if (row % majorEvery === 0 || row === rows) continue;
    const lineY = y + row * cell + 0.5;
    drawLine(x, lineY, x + width, lineY, thinWidth, thinColor);
  }
  for (let column = 0; column <= columns; column += majorEvery) {
    const lineX = x + column * cell + 0.5;
    drawLine(lineX, y, lineX, y + height, majorWidth, majorColor);
  }
  for (let row = 0; row <= rows; row += majorEvery) {
    const lineY = y + row * cell + 0.5;
    drawLine(x, lineY, x + width, lineY, majorWidth, majorColor);
  }
  drawLine(x + width + 0.5, y, x + width + 0.5, y + height, majorWidth, majorColor);
  drawLine(x, y + height + 0.5, x + width, y + height + 0.5, majorWidth, majorColor);
  context.strokeStyle = outerColor;
  context.lineWidth = outerWidth;
  context.strokeRect(x + 0.5, y + 0.5, width, height);
  context.restore();
}

function updateResultUi() {
  const hasResult = Boolean(state.grid.length);
  const mainUploadZone = document.querySelector(".main-center-workspace .workspace-stage > #upload-zone");
  if (mainUploadZone && !mainUploadZone.classList.contains("source-view")) {
    mainUploadZone.style.setProperty("display", hasResult ? "none" : "grid", "important");
  }
  els.resultPreview.hidden = !hasResult;
  els.emptyResult.hidden = hasResult;
  els.previewStage.disabled = !hasResult;
  els.previewStage.classList.toggle("empty", !hasResult);
  if (els.previewDownloadButton) {
    els.previewDownloadButton.hidden = !hasResult;
    els.previewDownloadButton.disabled = !hasResult;
  }
  if (els.mobileDownloadButton) els.mobileDownloadButton.disabled = !hasResult;
  if (els.mobileStartAssemblyButton) els.mobileStartAssemblyButton.disabled = !hasResult;
  if (els.mobilePreviewDownloadButton) els.mobilePreviewDownloadButton.disabled = !hasResult;
  if (els.mobileChartDownloadButton) els.mobileChartDownloadButton.disabled = !hasResult;
  if (els.mobilePrintA4Button) els.mobilePrintA4Button.disabled = !hasResult;
  els.editButton.disabled = !hasResult;
  if (els.mainPatternAdjustButton) els.mainPatternAdjustButton.disabled = !hasResult;
  if (els.startAssemblyButton) els.startAssemblyButton.disabled = !hasResult;
  if (els.startAssemblyPanelButton) els.startAssemblyPanelButton.disabled = !hasResult;
  els.downloadButton.disabled = false;
  if (els.downloadButtonTop) els.downloadButtonTop.disabled = false;
  document.body.classList.toggle("has-result", hasResult);

  if (hasResult) {
    els.resultPreview.src = state.previewUrl || state.chartUrl;
    const tileSummary = getTileSummary();
    const mirrorSummary = isMirrorEnabled() ? "镜像" : "";
    const printSummary = getA4PrintSummary();
    const total = state.stats.reduce((sum, item) => sum + item.count, 0);
    const difficulty = getPatternDifficulty(state.grid, state.stats);
    const extra = [tileSummary, mirrorSummary, printSummary].filter(Boolean).join(" · ");
    els.resultMetrics.innerHTML = `
      <span class="metric-card metric-grid"><small>格数</small><strong>${state.width}×${state.height}</strong></span>
      <span class="metric-card metric-difficulty"><small>难度</small><strong>${difficulty.label}</strong></span>
      <span class="metric-card metric-time"><small>耗时</small><strong>${difficulty.timeLabel}</strong></span>
      <span class="metric-card metric-size"><small>尺寸</small><strong>${formatFinishedSize(state.width, state.height).replace(" x ", "×").replace(" cm", "cm")}</strong></span>
      ${extra ? `<span class="metric-note">${extra}</span>` : ""}
    `;
    if (els.statsTotalLabel) {
      els.statsTotalLabel.textContent = `共${state.stats.length}色 · ${formatCount(total)}颗`;
    }
    if (els.paletteBudgetStatus && state.paletteBudget) {
      const budget = state.paletteBudget;
      const mode = budget.mode === "auto" ? `自动（建议 ${budget.effective}）` : `最大 ${budget.effective}`;
      els.paletteBudgetStatus.textContent = `${mode} · 实际颜色 ${state.stats.length} / ${budget.effective}`;
    }
  } else {
    els.resultPreview.removeAttribute("src");
    els.resultMetrics.innerHTML = `
      <span class="metric-card metric-grid"><small>格数</small><strong>0×0</strong></span>
      <span class="metric-card metric-difficulty"><small>难度</small><strong>-</strong></span>
      <span class="metric-card metric-time"><small>耗时</small><strong>-</strong></span>
      <span class="metric-card metric-size"><small>尺寸</small><strong>-</strong></span>
    `;
    if (els.statsTotalLabel) els.statsTotalLabel.textContent = "未生成";
    updateMaxColorPresetUi();
  }
  updateStatsList();
}

function updateStatsList() {
  els.statsList.replaceChildren();
  if (!state.stats.length) {
    els.statsSummary.textContent = "还没有图纸";
    return;
  }

  const total = state.stats.reduce((sum, item) => sum + item.count, 0);
  els.statsSummary.textContent = `色系：${getChartPaletteLabel()} · ${state.stats.length} 色 · ${formatCount(total)} 颗 · ${
    state.stats[0].code
  } 最多`;

  for (const item of state.stats) {
    const row = document.createElement("div");
    row.className = "stat-row";

    const swatch = document.createElement("span");
    swatch.className = "stat-swatch";
    swatch.style.backgroundColor = rgb(item);

    const code = document.createElement("span");
    code.className = `stat-code${isDark(item.rgb) ? " light-text" : ""}`;
    code.textContent = item.code;

    const count = document.createElement("span");
    count.className = "stat-count";
    count.textContent = `${formatCount(item.count)} · ${(item.count / total * 100).toFixed(1)}%`;

    row.append(swatch, code, count);
    els.statsList.append(row);
  }
}

function getPatternDifficulty(grid, stats) {
  const total = stats.reduce((sum, item) => sum + item.count, 0);
  const area = Math.max(1, (grid[0]?.length || 0) * grid.length);
  const colors = stats.length;
  const dominantRatio = total ? (stats[0]?.count || 0) / total : 0;
  const fillRatio = total / area;
  let score = 0;

  if (total > 2200) score += 1;
  if (total > 5200) score += 1;
  if (total > 10000) score += 1;
  if (total > 18000) score += 1;
  if (colors > 18) score += 1;
  if (colors > 36) score += 1;
  if (colors > 60) score += 1;
  if (dominantRatio > 0.42 && total > 1500) score += 0.7;
  if (dominantRatio < 0.16 && colors > 24) score += 0.7;
  if (fillRatio > 0.82 && total > 4000) score += 0.5;
  if (Math.max(state.width, state.height) > 130) score += 0.7;

  const label =
    score < 1.5 ? "入门" : score < 3 ? "标准" : score < 4.6 ? "进阶" : score < 6.2 ? "困难" : "大师";
  const speed = Math.max(360, 900 - score * 78);
  const hours = total / speed;
  let timeLabel = "-";
  if (total > 0) {
    if (hours < 1) timeLabel = "<1h";
    else if (hours < 3) timeLabel = `${Math.ceil(hours)}h`;
    else if (hours < 8) timeLabel = `${Math.ceil(hours)}h+`;
    else timeLabel = `${Math.ceil(hours / 2) * 2}h+`;
  }

  return { label, score, timeLabel };
}

function openPreview() {
  if (!state.previewUrl && !state.chartUrl) return;
  state.previewZoom = 1;
  state.previewModalUsesCurrentGrid = true;
  state.previewDetailCodesVisible = false;
  els.modalPreviewImage.src = state.previewUrl || state.chartUrl;
  setPreviewZoom(1);
  els.previewModal.showModal();
}

function setPreviewZoom(value) {
  state.previewZoom = clamp(value, 0.25, 5);
  if (state.previewModalUsesCurrentGrid && state.grid.length) {
    const showDetailGrid = state.previewZoom > 1;
    const showCodes = Boolean(window.LibmsRenderPolicy?.shouldShowBeadCode?.(state.previewZoom, state.previewRenderCell));
    if (showDetailGrid) {
      els.modalPreviewImage.src = renderBeadPattern({
        matrix: state.grid,
        stats: state.stats,
        preset: "ZOOM_DETAIL",
        cell: state.previewRenderCell,
        zoom: state.previewZoom,
      }).toDataURL("image/png");
    } else {
      els.modalPreviewImage.src = state.previewUrl;
    }
    state.previewDetailCodesVisible = showCodes;
  }
  els.modalPreviewImage.style.transform = `scale(${state.previewZoom})`;
}

function downloadPreviewImage() {
  if (!state.grid.length) return;
  const exportGrid = getExportGrid();
  recordLocalExportGrid(exportGrid, "preview", { showCodes: false, showGrid: false });
  const canvas = renderBeadPattern({ matrix: exportGrid, preset: "PREVIEW_EXPORT", cell: 8 });
  downloadUrl(canvas.toDataURL("image/png"), buildPreviewDownloadName());
  setStatus("已下载预览图");
}

async function downloadPattern(renderOptions = {}) {
  if (state.generationEngine !== "v2.5" && !ensureInviteRegistered()) return;

  if (!state.grid.length) {
    if (state.sourceDataUrl) {
      const generated = await processImage();
      if (!generated) return;
    } else {
      createBlankBoard({ openEditorAfterCreate: false });
    }
  }

  const exportGrid = getExportGrid();
  recordLocalExportGrid(exportGrid, "pattern", renderOptions);
  const exportStats = calculateStats(exportGrid);
  const tileSize = getSelectedTileSize();
  if (tileSize && (exportGrid[0]?.length > tileSize || exportGrid.length > tileSize)) {
    await downloadSplitPattern(tileSize, exportGrid);
    return;
  }

  const canvas = renderBeadPattern({ matrix: exportGrid, stats: exportStats, preset: "PATTERN_EXPORT",
    cell: getDownloadCellSize(),
    margin: 88,
    minLongSide: EXPORT_MIN_LONG_SIDE,
    subtitle: getExportSubtitle(),
    ...(renderOptions?.showGrid == null ? {} : { showGrid: renderOptions.showGrid }),
    ...(renderOptions?.showCodes == null ? {} : { showCodes: renderOptions.showCodes }),
    ...(renderOptions?.showCoordinates == null ? {} : { showCoordinates: renderOptions.showCoordinates }),
  });
  downloadUrl(canvas.toDataURL("image/png"), buildDownloadName());
  setStatus("已下载");
}

function ensureInviteRegistered() {
  if (getInviteProfile()) return true;
  openRegisterModal();
  els.registerMessage.textContent = "请先完成邀请注册，再下载 8K 高清图纸。";
  return false;
}

async function downloadSplitPattern(tileSize, grid = getExportGrid()) {
  const split = splitGridIntoTiles(grid, tileSize);
  const files = [];
  const cell = getSplitDownloadCellSize(tileSize);
  const mirrorLabel = getMirrorLabel();

  for (const tile of split.tiles) {
    const canvas = createChartCanvas(tile.grid, tile.stats, {
      cell,
      margin: 88,
      showCodes: true,
      minLongSide: EXPORT_MIN_LONG_SIDE,
      title: `第 ${tile.index} / ${split.tiles.length} 版 (R${tile.row} C${tile.col})`,
      subtitle: `全图 ${grid[0]?.length || 0} x ${grid.length}${mirrorLabel ? ` · ${mirrorLabel}` : ""} · 本版 ${tile.width} x ${tile.height} · 列 ${tile.x0 + 1}-${tile.x1} · 行 ${tile.y0 + 1}-${tile.y1} · ${tile.stats.length} 色 · ${getChartPaletteLabel()}`,
    });
    files.push({
      name: `board-r${padNumber(tile.row)}-c${padNumber(tile.col)}_cols-${tile.x0 + 1}-${tile.x1}_rows-${tile.y0 + 1}-${tile.y1}.png`,
      blob: await canvasToBlob(canvas),
    });
  }

  const zipBlob = await createZipBlob(files);
  downloadBlob(zipBlob, buildSplitDownloadName(tileSize));
  setStatus(`已分版下载 ${split.tiles.length} 版`);
}

async function downloadA4PrintPattern() {
  if (!ensureInviteRegistered()) return;

  if (!state.grid.length) {
    if (state.sourceDataUrl) {
      const generated = await processImage();
      if (!generated) return;
    } else {
      createBlankBoard({ openEditorAfterCreate: false });
    }
  }

  const grid = getExportGrid();
  const orientation = getPrintOrientation();
  const marginMm = getPrintMarginMm();
  const printSet = splitGridIntoA4Pages(grid, orientation, marginMm);
  const files = [];
  const mirrorLabel = getMirrorLabel();

  for (const tile of printSet.tiles) {
    const canvas = createA4PageCanvas(tile, {
      pageWidth: printSet.pageWidth,
      pageHeight: printSet.pageHeight,
      marginPx: printSet.marginPx,
      marginMm,
      orientation,
      mirrorLabel,
      pageIndex: tile.index,
      pageCount: printSet.tiles.length,
      fullWidth: grid[0]?.length || 0,
      fullHeight: grid.length,
    });
    files.push({
      name: `a4-page-${padNumber(tile.index)}_cols-${tile.x0 + 1}-${tile.x1}_rows-${tile.y0 + 1}-${tile.y1}.png`,
      blob: await canvasToBlob(canvas),
    });
  }

  if (files.length === 1) {
    downloadBlob(files[0].blob, buildA4DownloadName("png"));
  } else {
    const zipBlob = await createZipBlob(files);
    downloadBlob(zipBlob, buildA4DownloadName("zip"));
  }
  setStatus(`已生成A4打印 ${files.length} 页`);
}

function splitGridIntoTiles(grid, tileSize) {
  const rows = grid.length;
  const columns = grid[0]?.length || 0;
  const tileRows = Math.ceil(rows / tileSize);
  const tileColumns = Math.ceil(columns / tileSize);
  const tiles = [];

  for (let row = 0; row < tileRows; row += 1) {
    for (let col = 0; col < tileColumns; col += 1) {
      const x0 = col * tileSize;
      const y0 = row * tileSize;
      const width = Math.min(tileSize, columns - x0);
      const height = Math.min(tileSize, rows - y0);
      const tileGrid = Array.from({ length: height }, (_, y) =>
        grid[y0 + y].slice(x0, x0 + width).map(cloneColor),
      );
      tiles.push({
        col: col + 1,
        row: row + 1,
        index: tiles.length + 1,
        x0,
        y0,
        x1: x0 + width,
        y1: y0 + height,
        width,
        height,
        grid: tileGrid,
        stats: calculateStats(tileGrid),
      });
    }
  }

  return { tileColumns, tileRows, tiles };
}

function splitGridIntoA4Pages(grid, orientation, marginMm) {
  const isLandscape = orientation === "landscape";
  const pageWidth = mmToPx(isLandscape ? A4_SIZE_MM.height : A4_SIZE_MM.width);
  const pageHeight = mmToPx(isLandscape ? A4_SIZE_MM.width : A4_SIZE_MM.height);
  const marginPx = mmToPx(marginMm);
  const headerHeight = 218;
  const footerHeight = 92;
  const labelBand = 34;
  const cell = 30;
  const printableWidth = pageWidth - marginPx * 2 - labelBand * 2;
  const printableHeight = pageHeight - marginPx * 2 - headerHeight - footerHeight - labelBand * 2;
  const columnsPerPage = Math.max(1, Math.floor(printableWidth / cell));
  const rowsPerPage = Math.max(1, Math.floor(printableHeight / cell));
  return splitGridIntoTilesBySize(grid, columnsPerPage, rowsPerPage, {
    pageWidth,
    pageHeight,
    marginPx,
    columnsPerPage,
    rowsPerPage,
  });
}

function splitGridIntoTilesBySize(grid, tileWidth, tileHeight, extra = {}) {
  const rows = grid.length;
  const columns = grid[0]?.length || 0;
  const tileRows = Math.ceil(rows / tileHeight);
  const tileColumns = Math.ceil(columns / tileWidth);
  const tiles = [];

  for (let row = 0; row < tileRows; row += 1) {
    for (let col = 0; col < tileColumns; col += 1) {
      const x0 = col * tileWidth;
      const y0 = row * tileHeight;
      const width = Math.min(tileWidth, columns - x0);
      const height = Math.min(tileHeight, rows - y0);
      const tileGrid = Array.from({ length: height }, (_, y) =>
        grid[y0 + y].slice(x0, x0 + width).map(cloneColor),
      );
      tiles.push({
        col: col + 1,
        row: row + 1,
        index: tiles.length + 1,
        x0,
        y0,
        x1: x0 + width,
        y1: y0 + height,
        width,
        height,
        grid: tileGrid,
        stats: calculateStats(tileGrid),
      });
    }
  }

  return { tileColumns, tileRows, tiles, ...extra };
}

function getSelectedTileSize() {
  return Number(els.tileSizeSelect?.value || 0);
}

function isMirrorEnabled() {
  return els.mirrorSelect?.value === "mirror";
}

function getMirrorLabel() {
  return isMirrorEnabled() ? "镜像图纸" : "";
}

function getExportSubtitle() {
  return getMirrorLabel();
}

function getExportGrid() {
  let grid = isMirrorEnabled() ? mirrorGrid(state.grid) : cloneGrid(state.grid);
  const maxColors = state.paletteBudget?.effective || null;
  if (maxColors != null && !state.manualEdited) {
    const validation = window.LibmsRegionAwareQuantizer?.validateFinalPattern?.(grid, maxColors);
    if (validation && !validation.valid) grid = applyFinalPaletteBudget(grid, maxColors).grid;
    validateCurrentPatternOrThrow(grid, maxColors);
  }
  return grid;
}

function recordLocalExportGrid(grid, kind, settings) {
  if (!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) return;
  document.body.dataset.lastExportGrid = JSON.stringify({ kind, settings,
    width: grid[0]?.length || 0, height: grid.length,
    matrix: grid.map((row) => row.map((color) => color?.code || null)) });
}

function mirrorGrid(grid) {
  return grid.map((row) => row.slice().reverse().map(cloneColor));
}

function getPrintOrientation() {
  return els.printLayoutSelect?.value === "landscape" ? "landscape" : "portrait";
}

function getPrintMarginMm() {
  return clamp(Number(els.printMarginInput?.value) || 10, 5, 20);
}

function getTileSummary() {
  const tileSize = getSelectedTileSize();
  if (!tileSize || !state.width || !state.height) return "";
  const columns = Math.ceil(state.width / tileSize);
  const rows = Math.ceil(state.height / tileSize);
  return `${tileSize} 版 · ${columns * rows} 块`;
}

function getA4PrintSummary() {
  if (!state.width || !state.height) return "";
  const grid = isMirrorEnabled() ? mirrorGrid(state.grid) : state.grid;
  const printSet = splitGridIntoA4Pages(grid, getPrintOrientation(), getPrintMarginMm());
  return `A4 · ${printSet.tiles.length} 页`;
}

function mmToPx(mm) {
  return Math.round((mm / 25.4) * A4_DPI);
}

function getDownloadCellSize() {
  const maxSide = Math.max(state.width, state.height);
  if (maxSide <= 120) return 54;
  if (maxSide <= 180) return 40;
  if (maxSide <= 260) return 32;
  if (maxSide <= 380) return 26;
  return 24;
}

function getSplitDownloadCellSize(tileSize) {
  if (tileSize <= 52) return 54;
  if (tileSize <= 78) return 42;
  return 32;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      resolve(dataUrlToBlob(canvas.toDataURL("image/png")));
    }, "image/png");
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, data] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);/)?.[1] || "application/octet-stream";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function downloadUrl(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function buildDownloadName() {
  const base = getExportBaseName();
  return `${base}${isMirrorEnabled() ? "-mirror" : ""}-bead-pattern.png`;
}

function getExportBaseName() {
  return getSafeSchemeFilename() || state.sourceName.replace(/\.[^.]+$/, "") || "bead-pattern";
}

function buildPatternDownloadName(extension) {
  return `${getExportBaseName()}${isMirrorEnabled() ? "-mirror" : ""}-bead-pattern.${extension}`;
}

function hexFromRgb(rgbValue) {
  return `#${rgbValue
    .map((channel) => clamp(Math.round(Number(channel) || 0), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildPreviewDownloadName() {
  const base = getSafeSchemeFilename() || state.sourceName.replace(/\.[^.]+$/, "") || "bead-pattern";
  return `${base}-preview.png`;
}

function getSchemeName() {
  return els.schemeNameInput?.value.trim() || "";
}

function getSafeSchemeFilename() {
  return getSchemeName()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildSplitDownloadName(tileSize) {
  const base = state.sourceName.replace(/\.[^.]+$/, "") || "bead-pattern";
  return `${base}${isMirrorEnabled() ? "-mirror" : ""}-${tileSize}x${tileSize}-boards.zip`;
}

function buildA4DownloadName(extension) {
  const base = state.sourceName.replace(/\.[^.]+$/, "") || "bead-pattern";
  return `${base}${isMirrorEnabled() ? "-mirror" : ""}-a4-print.${extension}`;
}

async function createZipBlob(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const centralChunks = [];
  let offset = 0;
  const { dosDate, dosTime } = getZipDateTime(new Date());

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(bytes);
    const localHeader = createZipLocalHeader(nameBytes, bytes.length, crc, dosDate, dosTime);
    const centralHeader = createZipCentralHeader(
      nameBytes,
      bytes.length,
      crc,
      dosDate,
      dosTime,
      offset,
    );

    chunks.push(localHeader, bytes);
    centralChunks.push(centralHeader);
    offset += localHeader.length + bytes.length;
  }

  const centralOffset = offset;
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = createZipEndRecord(files.length, centralSize, centralOffset);
  return new Blob([...chunks, ...centralChunks, end], { type: "application/zip" });
}

function createZipLocalHeader(nameBytes, size, crc, dosDate, dosTime) {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, dosTime, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(nameBytes, 30);
  return header;
}

function createZipCentralHeader(nameBytes, size, crc, dosDate, dosTime, offset) {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, dosTime, true);
  view.setUint16(14, dosDate, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  header.set(nameBytes, 46);
  return header;
}

function createZipEndRecord(fileCount, centralSize, centralOffset) {
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return end;
}

function getZipDateTime(date) {
  return {
    dosDate: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function openAssemblyPlayer() {
  if (!state.grid.length) {
    setStatus("请先生成图纸，再开始拼");
    return;
  }
  state.playStorageKey = getAssemblyStorageKey();
  state.playCompletedBeads = loadAssemblyProgress(state.playStorageKey);
  state.playActiveCode = "";
  state.currentSelectedColor = null;
  syncAssemblyFocusMode();
  renderAssemblyColorList();
  renderInteractiveBoard();
  updateAssemblyProgressUi();
  pushAssemblyHistoryState();
  els.assemblyModal?.showModal();
}

function pushAssemblyHistoryState() {
  if (state.assemblyHistoryActive) return;
  try {
    window.history.pushState({ libaiAssembly: true }, "", window.location.href);
    state.assemblyHistoryActive = true;
  } catch (error) {
    console.warn("History state unavailable", error);
  }
}

function handleAssemblyPopState() {
  if (!state.assemblyHistoryActive || !els.assemblyModal?.open) return;
  try {
    window.history.pushState({ libaiAssembly: true }, "", window.location.href);
  } catch (error) {
    console.warn("History restore unavailable", error);
  }
  showExitModal();
}

function showExitModal() {
  if (!els.assemblyModal?.open || !els.exitModal) return;
  els.exitModal.setAttribute("aria-hidden", "false");
  if (!els.exitModal.open) {
    try {
      els.exitModal.showModal();
    } catch (error) {
      console.warn("Exit dialog unavailable", error);
    }
  }
  els.exitConfirmButton?.focus();
}

function hideExitModal() {
  if (!els.exitModal) return;
  els.exitModal.setAttribute("aria-hidden", "true");
  if (els.exitModal.open) els.exitModal.close();
}

function confirmAssemblyExit() {
  hideExitModal();
  state.assemblyHistoryActive = false;
  clearAssemblyCrosshair();
  els.assemblyModal?.close();
  setStatus("已退出开始拼");
}

function openDonateModal() {
  if (!els.donateModal) return;
  if (!els.donateModal.open) {
    try {
      els.donateModal.showModal();
    } catch (error) {
      console.warn("Donate dialog unavailable", error);
    }
  }
  els.donateCloseButton?.focus();
}

function closeDonateModal() {
  if (els.donateModal?.open) els.donateModal.close();
}

function getAssemblyStorageKey() {
  const signature = [
    getSchemeName() || state.sourceName || "local",
    `${state.width}x${state.height}`,
    state.paletteLabel || getCurrentPaletteLabel(),
    state.stats.map((item) => `${item.code}:${item.count}`).join(","),
  ].join("|");
  return `libai-maker-assembly-${fnv1aHash(signature)}`;
}

function loadAssemblyProgress(key) {
  try {
    const raw = localStorage.getItem(key);
    const values = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(values) ? values : []);
  } catch {
    return new Set();
  }
}

function saveAssemblyProgress() {
  if (!state.playStorageKey) return;
  localStorage.setItem(state.playStorageKey, JSON.stringify([...state.playCompletedBeads]));
}

function renderAssemblyColorList() {
  if (!els.assemblyColorList) return;
  els.assemblyColorList.replaceChildren();
  for (const item of state.stats) {
    const itemColor = rgb(item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `assembly-color-chip${state.playActiveCode === item.code ? " active" : ""}${
      isDark(item.rgb) ? " light-text" : ""
    }`;
    button.style.backgroundColor = itemColor;
    button.dataset.code = item.code;
    button.dataset.color = itemColor;
    button.innerHTML = `<strong>${item.code}</strong><span>${formatCount(item.count)}</span>`;
    button.addEventListener("click", () => selectAssemblyColor(item.code));
    els.assemblyColorList.append(button);
  }
}

function selectAssemblyColor(code) {
  if (!code || state.playActiveCode === code) {
    state.playActiveCode = "";
    state.currentSelectedColor = null;
  } else {
    const activeItem = state.stats.find((item) => item.code === code);
    state.playActiveCode = code;
    state.currentSelectedColor = activeItem ? rgb(activeItem) : null;
  }
  syncAssemblyFocusMode();
  renderAssemblyColorList();
  renderInteractiveBoard();
  updateAssemblyProgressUi();
}

function getAssemblyActiveColor() {
  return state.currentSelectedColor || "";
}

function syncAssemblyFocusMode() {
  const activeColor = getAssemblyActiveColor();
  document.body.classList.toggle("is-focus-mode", Boolean(activeColor));
  document.body.dataset.activeBeadColor = activeColor || "";
  document.documentElement.style.setProperty("--active-bead-color", activeColor || "transparent");
}

function clearAssemblyFocusMode() {
  state.playActiveCode = "";
  state.currentSelectedColor = null;
  state.assemblyHistoryActive = false;
  document.body.classList.remove("is-focus-mode");
  document.body.dataset.activeBeadColor = "";
  document.documentElement.style.setProperty("--active-bead-color", "transparent");
  hideExitModal();
  renderAssemblyColorList();
}

function getAssemblyLineClasses(rowIndex, colIndex) {
  const classes = [];
  if (Number.isInteger(colIndex)) {
    if ((colIndex + 1) % 10 === 0) classes.push("line-10-col");
    else if ((colIndex + 1) % 5 === 0) classes.push("line-5-col");
  }
  if (Number.isInteger(rowIndex)) {
    if ((rowIndex + 1) % 10 === 0) classes.push("line-10-row");
    else if ((rowIndex + 1) % 5 === 0) classes.push("line-5-row");
  }
  return classes.join(" ");
}

function createAxisCell(type, label, rowIndex, colIndex) {
  const axis = document.createElement("span");
  const lineClasses = getAssemblyLineClasses(rowIndex, colIndex);
  axis.className = `axis-cell ${type}${lineClasses ? ` ${lineClasses}` : ""}`;
  axis.textContent = label;
  axis.setAttribute("aria-hidden", "true");
  if (Number.isInteger(rowIndex)) axis.dataset.assemblyRow = String(rowIndex);
  if (Number.isInteger(colIndex)) axis.dataset.assemblyCol = String(colIndex);
  return axis;
}

function renderInteractiveBoard() {
  const container = els.assemblyBoard;
  if (!container) return;
  const rows = state.grid.length;
  const columns = state.grid[0]?.length || 0;
  const activeColor = getAssemblyActiveColor();
  state.playHoverRow = "";
  state.playHoverCol = "";
  container.replaceChildren();
  container.style.setProperty("--assembly-columns", String(columns));
  container.classList.toggle("hide-cell-text", state.assemblyHideCellText);

  container.append(createAxisCell("axis-corner", "", null, null));
  for (let colIndex = 0; colIndex < columns; colIndex += 1) {
    const label = colIndex % 10 === 0 ? String(colIndex + 1) : "";
    container.append(createAxisCell("axis-top", label, null, colIndex));
  }

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const axisLabel = rowIndex % 10 === 0 ? String(rowIndex + 1) : "";
    container.append(createAxisCell("axis-left", axisLabel, rowIndex, null));

    for (let colIndex = 0; colIndex < columns; colIndex += 1) {
      const bead = state.grid[rowIndex][colIndex];
      const cell = document.createElement("button");
      const coordKey = `${rowIndex}_${colIndex}`;
      const lineClasses = getAssemblyLineClasses(rowIndex, colIndex);
      cell.type = "button";
      cell.className = `bead-cell${lineClasses ? ` ${lineClasses}` : ""}`;
      cell.dataset.coord = coordKey;
      cell.dataset.row = String(rowIndex);
      cell.dataset.col = String(colIndex);
      cell.dataset.assemblyRow = String(rowIndex);
      cell.dataset.assemblyCol = String(colIndex);
      cell.setAttribute("aria-label", `行 ${rowIndex + 1}，列 ${colIndex + 1}`);

      if (!bead) {
        cell.classList.add("is-empty");
        cell.setAttribute("aria-disabled", "true");
      } else {
        const beadColor = rgb(bead);
        cell.dataset.code = bead.code;
        cell.dataset.color = beadColor;
        cell.style.backgroundColor = beadColor;
        cell.title = `${bead.code} · 行 ${rowIndex + 1} · 列 ${colIndex + 1}`;
        if (!state.assemblyHideCellText) {
          cell.innerHTML = `<span class="bead-code">${escapeHtml(bead.code)}</span>`;
        }
        if (state.playCompletedBeads.has(coordKey)) cell.classList.add("is-completed");
        if (activeColor && beadColor === activeColor) cell.classList.add("is-focus-target");
      }

      container.append(cell);
    }
  }
}

function handleAssemblyBoardPointerOver(event) {
  const cell = event.target.closest?.(".bead-cell");
  if (!cell || !els.assemblyBoard?.contains(cell)) return;
  setAssemblyCrosshair(cell.dataset.row || "", cell.dataset.col || "");
}

function setAssemblyCrosshair(row, col) {
  if (state.playHoverRow === row && state.playHoverCol === col) return;
  clearAssemblyCrosshair();
  const container = els.assemblyBoard;
  if (!container || row === "" || col === "") return;
  state.playHoverRow = row;
  state.playHoverCol = col;
  container.querySelectorAll(`[data-assembly-row="${row}"]`).forEach((node) => {
    node.classList.add("is-row-hover");
  });
  container.querySelectorAll(`[data-assembly-col="${col}"]`).forEach((node) => {
    node.classList.add("is-col-hover");
  });
}

function clearAssemblyCrosshair() {
  const container = els.assemblyBoard;
  if (!container) return;
  container.querySelectorAll(".is-row-hover, .is-col-hover").forEach((node) => {
    node.classList.remove("is-row-hover", "is-col-hover");
  });
  state.playHoverRow = "";
  state.playHoverCol = "";
}

function handleAssemblyBoardClick(event) {
  const cell = event.target.closest?.(".bead-cell");
  if (!cell || cell.classList.contains("is-empty")) return;
  const coordKey = cell.dataset.coord;
  if (!coordKey) return;
  if (state.playCompletedBeads.has(coordKey)) {
    state.playCompletedBeads.delete(coordKey);
  } else {
    state.playCompletedBeads.add(coordKey);
  }
  saveAssemblyProgress();
  renderInteractiveBoard();
  updateAssemblyProgressUi();
}

function resetAssemblyProgress() {
  if (!state.playCompletedBeads.size) return;
  if (!window.confirm("确认清空当前图纸的拼豆进度？")) return;
  state.playCompletedBeads.clear();
  saveAssemblyProgress();
  renderInteractiveBoard();
  updateAssemblyProgressUi();
}

function updateAssemblyProgressUi() {
  const total = state.stats.reduce((sum, item) => sum + item.count, 0);
  let completed = 0;
  state.playCompletedBeads.forEach((key) => {
    const [row, col] = key.split("_").map(Number);
    if (state.grid[row]?.[col]) completed += 1;
  });
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const activeText = state.playActiveCode ? ` · 当前高亮 ${state.playActiveCode}` : "";
  if (els.assemblyProgressLabel) {
    els.assemblyProgressLabel.textContent = `${formatCount(completed)} / ${formatCount(total)} · ${percent}%`;
  }
  if (els.assemblySummary) {
    els.assemblySummary.textContent = `点击色号可高亮同色，点击格子可标记已拼${activeText}。进度只保存在本机浏览器。`;
  }
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function openEditor() {
  if (!state.grid.length) return;
  state.editorGrid = cloneGrid(state.grid);
  state.editorZoom = 1;
  state.selectedColor = null;
  state.editorTool = "pencil";
  state.editorFloating = null;
  state.editorSelection = null;
  state.activeEditorSelection = null;
  state.editorReferenceImage = null;
  state.editorReference = null;
  state.referenceUndo = [];
  state.assemblyMode = false;
  state.assemblyHighlightCode = "";
  state.paintUndo = [];
  state.replaceUndo = [];
  if (els.artworkNameInput) els.artworkNameInput.value = buildGalleryTitle();
  updateEditorPaletteOptions();
  els.editorPaletteSelect.value = getCurrentPaletteKey();
  syncEditorPrefsControls();
  renderEditorLibraryOptions();
  updateEditorToolUi();
  updateEditorFloatingUi();
  updateAssemblyUi();
  syncReferenceControls();
  renderPaletteGroups();
  updateCurrentSelection();
  updateReplaceOptions();
  renderEditorCanvas();
  updateEditorControls();
  els.editorModal.showModal();
}

function syncEditorPalette() {
  const palette = getEditorPalette();
  if (
    state.selectedColor &&
    !palette.some((color) => color.code === state.selectedColor.code)
  ) {
    state.selectedColor = null;
  }
  renderPaletteGroups();
  updateReplaceOptions();
  updateCurrentSelection();
}

function setEditorTool(tool) {
  state.editorTool = ["pencil", "eraser", "eyedropper", "fill", "rectangle", "cut", "copy"].includes(tool)
    ? tool
    : "pencil";
  state.assemblyMode = false;
  state.assemblyHighlightCode = "";
  updateEditorToolUi();
  updateAssemblyUi();
  renderEditorCanvas();
}

function updateEditorToolUi() {
  els.editorToolButtons.forEach((button) => {
    const active = button.dataset.editorTool === state.editorTool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (els.editorCanvas) {
    els.editorCanvas.dataset.tool = state.assemblyMode ? "assembly" : state.editorTool;
  }
}

function syncEditorPrefsControls() {
  if (els.toggleEditorGrid) els.toggleEditorGrid.checked = state.editorPrefs.showGrid;
  if (els.toggleEditorCodes) els.toggleEditorCodes.checked = state.editorPrefs.showCodes;
  if (els.toggleEditorCoords) els.toggleEditorCoords.checked = state.editorPrefs.showCoords;
  if (els.toggleEditorSnap) els.toggleEditorSnap.checked = state.editorPrefs.snap;
  if (els.editorToolbarPosition) els.editorToolbarPosition.value = state.editorPrefs.toolbarPosition;
  applyEditorToolbarPosition();
}

function updateEditorPrefsFromControls() {
  state.editorPrefs.showGrid = Boolean(els.toggleEditorGrid?.checked);
  state.editorPrefs.showCodes = Boolean(els.toggleEditorCodes?.checked);
  state.editorPrefs.showCoords = Boolean(els.toggleEditorCoords?.checked);
  state.editorPrefs.snap = Boolean(els.toggleEditorSnap?.checked);
  state.editorPrefs.toolbarPosition = els.editorToolbarPosition?.value === "right" ? "right" : "left";
  applyEditorToolbarPosition();
  renderEditorCanvas();
}

function applyEditorToolbarPosition() {
  els.editorModal?.classList.toggle("toolbar-right", state.editorPrefs.toolbarPosition === "right");
}

function renderPaletteGroups() {
  const groups = new Map();
  for (const color of getEditorPalette()) {
    const key = color.code.match(/^[A-Z]+/)?.[0] || color.code[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(color);
  }

  els.paletteGroups.replaceChildren();
  for (const [group, colors] of groups) {
    const section = document.createElement("section");
    section.className = "palette-group";
    const title = document.createElement("strong");
    title.textContent = group;
    const grid = document.createElement("div");
    grid.className = "swatch-grid";

    for (const color of colors) {
      const button = document.createElement("button");
      button.className = `color-swatch${isDark(color.rgb) ? " light-text" : ""}${
        state.selectedColor?.code === color.code ? " selected" : ""
      }${state.assemblyHighlightCode === color.code ? " highlighted" : ""}${
        state.assemblyMode ? " assembly-select" : ""
      }`;
      button.type = "button";
      button.title = color.code;
      button.textContent = color.code;
      button.style.backgroundColor = rgb(color);
      button.addEventListener("click", () => {
        if (state.assemblyMode) {
          state.assemblyHighlightCode = color.code;
          renderPaletteGroups();
          renderEditorCanvas();
          return;
        }
        selectEditorColor(color);
      });
      grid.append(button);
    }

    section.append(title, grid);
    els.paletteGroups.append(section);
  }
}

function selectEditorColor(color) {
  state.selectedColor = color ? cloneColor(color) : null;
  renderPaletteGroups();
  updateCurrentSelection();
}

function updateCurrentSelection() {
  if (!state.selectedColor) {
    els.currentSelection.textContent = "留空";
    els.currentSwatch.className = "current-swatch empty";
    els.currentSwatch.style.backgroundColor = "";
    return;
  }
  els.currentSelection.textContent = state.selectedColor.code;
  els.currentSwatch.className = "current-swatch";
  els.currentSwatch.style.backgroundColor = rgb(state.selectedColor);
}

function getEditorCellFromPointer(event) {
  const canvas = els.editorCanvas;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  const cellSize = getEditorRenderCellSize();
  const column = Math.floor((x - EDITOR_MARGIN) / cellSize);
  const row = Math.floor((y - EDITOR_MARGIN) / cellSize);
  if (
    row < 0 ||
    column < 0 ||
    row >= state.editorGrid.length ||
    column >= (state.editorGrid[0]?.length || 0)
  ) {
    return null;
  }
  return { column, row };
}

function handleEditorPointerDown(event) {
  event.preventDefault();
  const cell = getEditorCellFromPointer(event);
  if (!cell) return;

  if (state.editorFloating && isCellInsideFloating(cell.column, cell.row)) {
    state.editorFloating.dragging = true;
    state.editorFloating.startColumn = cell.column;
    state.editorFloating.startRow = cell.row;
    state.editorFloating.originX = state.editorFloating.x;
    state.editorFloating.originY = state.editorFloating.y;
    return;
  }

  if (state.assemblyMode) {
    const color = state.editorGrid[cell.row][cell.column];
    state.assemblyHighlightCode = color?.code || "";
    renderPaletteGroups();
    renderEditorCanvas();
    return;
  }

  if (state.editorTool === "eyedropper") {
    const color = state.editorGrid[cell.row][cell.column];
    selectEditorColor(color);
    setEditorTool("pencil");
    return;
  }

  if (state.editorTool === "cut" || state.editorTool === "copy" || state.editorTool === "rectangle") {
    state.editorSelection = {
      mode: state.editorTool,
      x0: cell.column,
      y0: cell.row,
      x1: cell.column,
      y1: cell.row,
    };
    renderEditorCanvas();
    return;
  }

  if (state.editorTool === "fill") {
    fillEditorRegion(cell.column, cell.row);
    return;
  }

  paintEditorCell(cell.column, cell.row);
}

function handleEditorPointerMove(event) {
  const cell = getEditorCellFromPointer(event);
  if (!cell) return;

  if (state.editorFloating?.dragging) {
    const nextX = state.editorFloating.originX + cell.column - state.editorFloating.startColumn;
    const nextY = state.editorFloating.originY + cell.row - state.editorFloating.startRow;
    state.editorFloating.x = clamp(
      Math.round(nextX),
      0,
      Math.max(0, (state.editorGrid[0]?.length || 0) - state.editorFloating.width),
    );
    state.editorFloating.y = clamp(
      Math.round(nextY),
      0,
      Math.max(0, state.editorGrid.length - state.editorFloating.height),
    );
    renderEditorCanvas();
    return;
  }

  if (state.editorSelection) {
    state.editorSelection.x1 = cell.column;
    state.editorSelection.y1 = cell.row;
    renderEditorCanvas();
    return;
  }

  if (state.editorTool === "pencil" || state.editorTool === "eraser") {
    paintEditorCell(cell.column, cell.row);
  }
}

function finishEditorPointerAction() {
  if (state.editorSelection) {
    finalizeEditorSelection();
  }
  if (state.editorFloating) {
    state.editorFloating.dragging = false;
  }
  if (state.currentPaintAction.length) state.paintUndo.push(state.currentPaintAction);
  state.currentPaintAction = [];
  state.isPainting = false;
  state.lastPaintKey = "";
}

function isCellInsideFloating(column, row) {
  const floating = state.editorFloating;
  if (!floating) return false;
  return (
    column >= floating.x &&
    row >= floating.y &&
    column < floating.x + floating.width &&
    row < floating.y + floating.height
  );
}

function finalizeEditorSelection() {
  const selection = state.editorSelection;
  state.editorSelection = null;
  if (!selection) return;
  const x0 = Math.min(selection.x0, selection.x1);
  const y0 = Math.min(selection.y0, selection.y1);
  const x1 = Math.max(selection.x0, selection.x1);
  const y1 = Math.max(selection.y0, selection.y1);
  if (selection.mode === "rectangle") {
    state.activeEditorSelection = { x0, y0, x1, y1 };
    renderEditorCanvas();
    updateEditorControls();
    return;
  }
  const pattern = [];
  const cutAction = [];

  for (let y = y0; y <= y1; y += 1) {
    const row = [];
    for (let x = x0; x <= x1; x += 1) {
      const oldColor = cloneColor(state.editorGrid[y][x]);
      row.push(oldColor);
      if (selection.mode === "cut" && oldColor) {
        cutAction.push({ x, y, oldColor });
        state.editorGrid[y][x] = null;
      }
    }
    pattern.push(row);
  }

  if (!pattern.some((row) => row.some(Boolean))) {
    renderEditorCanvas();
    return;
  }
  if (cutAction.length) state.replaceUndo.push(cutAction);
  setFloatingPattern(pattern, x0, y0, selection.mode === "cut" ? "剪切移动" : "复制移动");
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function setFloatingPattern(grid, x, y, title) {
  state.editorFloating = {
    grid: cloneGrid(grid),
    x,
    y,
    width: grid[0]?.length || 0,
    height: grid.length,
    title,
    dragging: false,
  };
  updateEditorFloatingUi();
}

function updateEditorFloatingUi() {
  const hasFloating = Boolean(state.editorFloating);
  if (els.floatingTools) els.floatingTools.hidden = !hasFloating;
  if (els.floatingTitle) {
    els.floatingTitle.textContent = hasFloating ? state.editorFloating.title : "待放置图案";
  }
}

function renderEditorCanvas() {
  const canvas = els.editorCanvas;
  const context = canvas.getContext("2d");
  const rows = state.editorGrid.length;
  const columns = state.editorGrid[0]?.length || 0;
  const cell = getEditorRenderCellSize();
  const margin = EDITOR_MARGIN;
  canvas.width = columns * cell + margin * 2;
  canvas.height = rows * cell + margin * 2;

  context.fillStyle = "#fffdf7";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (state.editorReferenceImage && state.editorReference?.visible !== false) {
    const reference = state.editorReference || createDefaultReferenceState(state.editorReferenceImage);
    const drawWidth = columns * cell * reference.scale;
    const drawHeight = rows * cell * reference.scale;
    context.save();
    context.globalAlpha = reference.opacity;
    context.translate(
      margin + columns * cell / 2 + reference.x * cell,
      margin + rows * cell / 2 + reference.y * cell,
    );
    context.rotate(reference.rotation * Math.PI / 180);
    context.drawImage(state.editorReferenceImage, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    context.restore();
  }
  context.font = `800 12px ${CANVAS_FONT_STACK}`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  if (state.editorPrefs.showCoords) {
    for (let x = 0; x < columns; x += 1) {
      context.fillStyle = "#69716e";
      context.fillText(String(x + 1), margin + x * cell + cell / 2, margin - 13);
      context.fillText(String(x + 1), margin + x * cell + cell / 2, margin + rows * cell + 15);
    }
  }

  for (let y = 0; y < rows; y += 1) {
    if (state.editorPrefs.showCoords) {
      context.fillStyle = "#69716e";
      context.textAlign = "right";
      context.fillText(String(y + 1), margin - 8, margin + y * cell + cell / 2);
      context.textAlign = "left";
      context.fillText(String(y + 1), margin + columns * cell + 8, margin + y * cell + cell / 2);
      context.textAlign = "center";
    }

    for (let x = 0; x < columns; x += 1) {
      const color = state.editorGrid[y][x];
      const px = margin + x * cell;
      const py = margin + y * cell;
      const dimmed =
        state.assemblyMode &&
        state.assemblyHighlightCode &&
        color?.code !== state.assemblyHighlightCode;
      if (color) {
        context.fillStyle = rgb(color);
        context.fillRect(px, py, cell, cell);
        if (dimmed) {
          context.fillStyle = "rgba(255,255,255,0.68)";
          context.fillRect(px, py, cell, cell);
        }
        if (state.editorPrefs.showCodes && cell >= 14) {
          context.fillStyle = isDark(color.rgb) && !dimmed ? "#fff" : "#1f2422";
          context.font = `900 10px ${CANVAS_FONT_STACK}`;
          context.fillText(color.code, px + cell / 2, py + cell / 2 + 1);
        }
      } else {
        drawEmptyCell(context, px, py, cell);
      }
      if (state.editorPrefs.showGrid) {
        context.strokeStyle = "rgba(31, 36, 34, 0.36)";
        context.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
      }
      if (state.assemblyMode && state.assemblyHighlightCode && color?.code === state.assemblyHighlightCode) {
        context.strokeStyle = "#e60023";
        context.lineWidth = 3;
        context.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
        context.lineWidth = 1;
      }
    }
  }

  drawEditorSelectionOverlay(context, margin, cell);
  drawEditorFloatingPattern(context, margin, cell);
  drawReferenceAlignmentOverlay(context, margin, cell, columns, rows);

  setEditorZoom(state.editorZoom);
}

function getEditorRenderCellSize() {
  const rows = state.editorGrid.length;
  const columns = state.editorGrid[0]?.length || 0;
  return Math.max(1, Math.min(EDITOR_CELL_SIZE, Math.floor((4096 - EDITOR_MARGIN * 2) / Math.max(1, rows, columns))));
}

function drawEditorSelectionOverlay(context, margin, cell) {
  const selection = state.editorSelection || state.activeEditorSelection;
  if (!selection) return;
  const x0 = Math.min(selection.x0, selection.x1);
  const y0 = Math.min(selection.y0, selection.y1);
  const x1 = Math.max(selection.x0, selection.x1);
  const y1 = Math.max(selection.y0, selection.y1);
  context.save();
  context.fillStyle = "rgba(67, 94, 229, 0.14)";
  context.strokeStyle = "#435ee5";
  context.lineWidth = 3;
  context.setLineDash([8, 6]);
  context.fillRect(margin + x0 * cell, margin + y0 * cell, (x1 - x0 + 1) * cell, (y1 - y0 + 1) * cell);
  context.strokeRect(
    margin + x0 * cell + 1.5,
    margin + y0 * cell + 1.5,
    (x1 - x0 + 1) * cell - 3,
    (y1 - y0 + 1) * cell - 3,
  );
  context.restore();
}

function drawEditorFloatingPattern(context, margin, cell) {
  const floating = state.editorFloating;
  if (!floating) return;
  context.save();
  context.globalAlpha = 0.82;
  for (let y = 0; y < floating.height; y += 1) {
    for (let x = 0; x < floating.width; x += 1) {
      const color = floating.grid[y][x];
      if (!color) continue;
      const px = margin + (floating.x + x) * cell;
      const py = margin + (floating.y + y) * cell;
      context.fillStyle = rgb(color);
      context.fillRect(px, py, cell, cell);
      if (state.editorPrefs.showCodes) {
        context.fillStyle = isDark(color.rgb) ? "#fff" : "#1f2422";
        context.font = `900 10px ${CANVAS_FONT_STACK}`;
        context.fillText(color.code, px + cell / 2, py + cell / 2 + 1);
      }
    }
  }
  context.globalAlpha = 1;
  context.strokeStyle = "#435ee5";
  context.lineWidth = 4;
  context.setLineDash([10, 6]);
  context.strokeRect(
    margin + floating.x * cell + 2,
    margin + floating.y * cell + 2,
    floating.width * cell - 4,
    floating.height * cell - 4,
  );
  context.restore();
}

function setEditorZoom(value) {
  state.editorZoom = clamp(value, 0.35, 3);
  els.editorCanvas.style.transform = `scale(${state.editorZoom})`;
  els.editorZoomLabel.textContent = `${Math.round(state.editorZoom * 100)}%`;
}

function paintFromPointer(event) {
  const cell = getEditorCellFromPointer(event);
  if (!cell) return;
  paintEditorCell(cell.column, cell.row);
}

function paintEditorCell(column, row) {
  const key = `${column}:${row}`;
  if (key === state.lastPaintKey) return;
  state.lastPaintKey = key;
  const oldColor = cloneColor(state.editorGrid[row][column]);
  const nextColor = state.editorTool === "eraser" ? null : cloneColor(state.selectedColor);
  if (sameColor(oldColor, nextColor)) return;
  state.editorGrid[row][column] = nextColor;
  state.currentPaintAction.push({ x: column, y: row, oldColor });
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function undoPaint() {
  const action = state.paintUndo.pop();
  if (!action) {
    const referenceAction = state.referenceUndo.pop();
    if (!referenceAction) return;
    state.editorReferenceImage = referenceAction.image || null;
    state.editorReference = referenceAction.metadata
      ? { ...referenceAction.metadata, image: referenceAction.image }
      : null;
    syncReferenceControls();
    renderEditorCanvas();
    updateEditorControls();
    return;
  }
  const items = Array.isArray(action) ? action : [action];
  for (const item of items) state.editorGrid[item.y][item.x] = cloneColor(item.oldColor);
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function fillEditorRegion(column, row) {
  const source = state.editorGrid[row]?.[column] || null;
  const target = cloneColor(state.selectedColor);
  if (sameColor(source, target)) return;
  const width = state.editorGrid[0]?.length || 0;
  const height = state.editorGrid.length;
  const visited = new Uint8Array(width * height);
  const queue = [[column, row]];
  const action = [];
  for (let head = 0; head < queue.length; head += 1) {
    const [x, y] = queue[head];
    const index = y * width + x;
    if (visited[index] || !sameColor(state.editorGrid[y]?.[x] || null, source)) continue;
    visited[index] = 1;
    action.push({ x, y, oldColor: cloneColor(state.editorGrid[y][x]) });
    state.editorGrid[y][x] = cloneColor(target);
    if (x > 0) queue.push([x - 1, y]);
    if (x + 1 < width) queue.push([x + 1, y]);
    if (y > 0) queue.push([x, y - 1]);
    if (y + 1 < height) queue.push([x, y + 1]);
  }
  if (action.length) state.paintUndo.push(action);
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function updateReplaceOptions() {
  const stats = calculateStats(state.editorGrid);
  els.replaceFrom.replaceChildren(new Option("选择要替换的色号", ""));
  for (const item of stats) {
    els.replaceFrom.append(new Option(`${item.code} (${item.count})`, item.code));
  }

  els.replaceTo.replaceChildren(new Option("挖空（留空格）", ""));
  for (const color of getEditorPalette()) {
    els.replaceTo.append(new Option(color.code, color.code));
  }
}

function updateEditorControls() {
  els.undoPaintButton.disabled = state.paintUndo.length === 0 && state.referenceUndo.length === 0;
  els.undoReplaceButton.disabled = state.replaceUndo.length === 0;
  els.replaceButton.disabled = !els.replaceFrom.value;
  if (els.fillSelectionButton) els.fillSelectionButton.disabled = !state.activeEditorSelection;
  if (els.clearSelectionButton) els.clearSelectionButton.disabled = !state.activeEditorSelection;
  updateLibraryImportButton();
}

function applyColorToSelection(color) {
  const selection = state.activeEditorSelection;
  if (!selection) return;
  const action = [];
  for (let y = selection.y0; y <= selection.y1; y += 1) {
    for (let x = selection.x0; x <= selection.x1; x += 1) {
      const oldColor = state.editorGrid[y][x];
      if (sameColor(oldColor, color)) continue;
      action.push({ x, y, oldColor: cloneColor(oldColor) });
      state.editorGrid[y][x] = cloneColor(color);
    }
  }
  if (action.length) state.replaceUndo.push(action);
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function updateLibraryImportButton() {
  if (els.importLibraryButton) {
    els.importLibraryButton.disabled = !els.libraryImportSelect?.value;
  }
}

function applyFloatingPattern() {
  const floating = state.editorFloating;
  if (!floating) return;
  const action = [];
  for (let y = 0; y < floating.height; y += 1) {
    for (let x = 0; x < floating.width; x += 1) {
      const color = floating.grid[y][x];
      if (!color) continue;
      const targetX = floating.x + x;
      const targetY = floating.y + y;
      if (
        targetY < 0 ||
        targetX < 0 ||
        targetY >= state.editorGrid.length ||
        targetX >= (state.editorGrid[0]?.length || 0)
      ) {
        continue;
      }
      action.push({ x: targetX, y: targetY, oldColor: cloneColor(state.editorGrid[targetY][targetX]) });
      state.editorGrid[targetY][targetX] = cloneColor(color);
    }
  }
  if (action.length) state.replaceUndo.push(action);
  state.editorFloating = null;
  updateEditorFloatingUi();
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function cancelFloatingPattern() {
  state.editorFloating = null;
  updateEditorFloatingUi();
  renderEditorCanvas();
}

function importSelectedLibraryItem() {
  const id = els.libraryImportSelect?.value;
  if (!id) return;
  const item = getGeneratedGallery().find((entry) => entry.id === id);
  const grid = deserializeGridFromLibrary(item);
  if (!grid) {
    setStatus("作品库缺少可编辑数据");
    return;
  }
  const x = Math.max(0, Math.floor(((state.editorGrid[0]?.length || 0) - (grid[0]?.length || 0)) / 2));
  const y = Math.max(0, Math.floor((state.editorGrid.length - grid.length) / 2));
  setFloatingPattern(grid, x, y, `导入：${item.title}`);
  renderEditorCanvas();
}

function transformEditorGrid(type) {
  const oldGrid = cloneGrid(state.editorGrid);
  if (type === "flip-horizontal") {
    state.editorGrid = state.editorGrid.map((row) => row.slice().reverse().map(cloneColor));
  } else if (type === "flip-vertical") {
    state.editorGrid = state.editorGrid.slice().reverse().map((row) => row.map(cloneColor));
  } else if (type === "scale-down") {
    state.editorGrid = scaleGridNearest(state.editorGrid, 0.5);
  } else if (type === "scale-up") {
    state.editorGrid = scaleGridNearest(state.editorGrid, 2);
  }
  state.replaceUndo.push(gridToUndoAction(oldGrid));
  state.editorFloating = null;
  updateEditorFloatingUi();
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function scaleGridNearest(grid, factor) {
  const rows = grid.length;
  const columns = grid[0]?.length || 0;
  const nextRows = Math.max(1, Math.round(rows * factor));
  const nextColumns = Math.max(1, Math.round(columns * factor));
  return Array.from({ length: nextRows }, (_, y) =>
    Array.from({ length: nextColumns }, (_, x) => {
      const sourceY = Math.min(rows - 1, Math.floor(y / factor));
      const sourceX = Math.min(columns - 1, Math.floor(x / factor));
      return cloneColor(grid[sourceY]?.[sourceX] || null);
    }),
  );
}

function gridToUndoAction(grid) {
  const action = [];
  grid.forEach((row, y) => {
    row.forEach((color, x) => {
      action.push({ x, y, oldColor: cloneColor(color) });
    });
  });
  action.fullGrid = cloneGrid(grid);
  return action;
}

function loadEditorReferenceImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
    window.alert("参考图仅支持 PNG、JPG、JPEG 或 WebP。");
    return;
  }
  if (els.referenceImageButton) {
    els.referenceImageButton.disabled = true;
    els.referenceImageButton.textContent = "读取中...";
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      pushReferenceUndo();
      state.editorReferenceImage = image;
      state.editorReference = createDefaultReferenceState(image);
      syncReferenceControls();
      renderEditorCanvas();
      setStatus("已添加参考图");
      if (els.referenceImageButton) {
        els.referenceImageButton.disabled = false;
        els.referenceImageButton.textContent = "更换参考图";
      }
    };
    image.onerror = () => {
      window.alert("参考图读取失败，请换一张图片重试。");
      if (els.referenceImageButton) {
        els.referenceImageButton.disabled = false;
        els.referenceImageButton.textContent = "添加参考图";
      }
    };
    image.src = String(reader.result);
  };
  reader.onerror = () => window.alert("参考图文件读取失败。");
  reader.readAsDataURL(file);
}

function clearEditorReferenceImage() {
  if (!state.editorReferenceImage) return;
  pushReferenceUndo();
  state.editorReferenceImage = null;
  state.editorReference = null;
  if (els.referenceImageInput) els.referenceImageInput.value = "";
  syncReferenceControls();
  renderEditorCanvas();
}

function createDefaultReferenceState(image) {
  return {
    image,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 0.4,
    visible: true,
    locked: false,
    gridOffsetX: 0,
    gridOffsetY: 0,
    gridCellWidth: EDITOR_CELL_SIZE,
    gridCellHeight: EDITOR_CELL_SIZE,
    showAlignment: false,
  };
}

function pushReferenceUndo() {
  state.referenceUndo.push({
    image: state.editorReferenceImage,
    metadata: state.editorReference ? { ...state.editorReference, image: undefined } : null,
  });
  if (state.referenceUndo.length > 20) state.referenceUndo.shift();
}

function syncReferenceControls() {
  const reference = state.editorReference;
  if (els.referenceControls) els.referenceControls.hidden = !reference;
  if (els.clearReferenceButton) els.clearReferenceButton.disabled = !reference;
  if (!reference) return;
  els.referenceOpacity.value = String(Math.round(reference.opacity * 100));
  els.referenceScale.value = String(Math.round(reference.scale * 100));
  els.referenceRotation.value = String(reference.rotation);
  els.referenceOpacityOutput.textContent = `${Math.round(reference.opacity * 100)}%`;
  els.referenceScaleOutput.textContent = `${Math.round(reference.scale * 100)}%`;
  els.referenceRotationOutput.textContent = `${reference.rotation}°`;
  els.referenceVisibleButton.textContent = reference.visible ? "隐藏" : "显示";
  els.referenceLockButton.textContent = reference.locked ? "解锁" : "锁定";
}

function updateReferenceControls() {
  const reference = state.editorReference;
  if (!reference) return;
  reference.opacity = clamp(Number(els.referenceOpacity.value) / 100, 0, 1);
  reference.scale = clamp(Number(els.referenceScale.value) / 100, 0.1, 3);
  reference.rotation = clamp(Number(els.referenceRotation.value), -15, 15);
  syncReferenceControls();
  renderEditorCanvas();
}

function toggleReferenceVisibility() {
  if (!state.editorReference) return;
  pushReferenceUndo();
  state.editorReference.visible = !state.editorReference.visible;
  syncReferenceControls();
  renderEditorCanvas();
}

function toggleReferenceLock() {
  if (!state.editorReference) return;
  state.editorReference.locked = !state.editorReference.locked;
  syncReferenceControls();
}

function nudgeReference(value) {
  const reference = state.editorReference;
  if (!reference || reference.locked) return;
  pushReferenceUndo();
  const [dx, dy] = String(value || "0,0").split(",").map(Number);
  reference.x += dx;
  reference.y += dy;
  renderEditorCanvas();
}

function openPatternAdjustDialog(target = "editor") {
  const source = target === "main" ? state.grid : state.editorGrid;
  if (!source.length) {
    window.alert("请先创建或生成图纸。");
    return;
  }
  state.patternAdjustTarget = target;
  state.patternAdjustBase = cloneGrid(source);
  resetPatternAdjustment();
  els.patternAdjustModal?.showModal();
}

function getPatternAdjustments() {
  return Object.fromEntries([...els.patternAdjustInputs].map((input) => [input.dataset.patternAdjust, Number(input.value || 0)]));
}

function resetPatternAdjustment() {
  els.patternAdjustInputs.forEach((input) => {
    input.value = "0";
    const output = document.querySelector(`[data-adjust-output="${input.dataset.patternAdjust}"]`);
    if (output) output.textContent = "0";
  });
  if (state.patternAdjustBase) state.patternAdjustPreviewGrid = cloneGrid(state.patternAdjustBase);
  renderPatternAdjustmentPreview();
}

function previewPatternAdjustment() {
  els.patternAdjustInputs.forEach((input) => {
    const output = document.querySelector(`[data-adjust-output="${input.dataset.patternAdjust}"]`);
    if (output) output.textContent = input.value;
  });
  if (!state.patternAdjustBase) return;
  window.cancelAnimationFrame(state.patternAdjustFrame);
  state.patternAdjustFrame = window.requestAnimationFrame(() => {
    state.patternAdjustPreviewGrid = createAdjustedPattern(state.patternAdjustBase, getPatternAdjustments());
    renderPatternAdjustmentPreview();
  });
}

function renderPatternAdjustmentPreview() {
  if (!els.patternAdjustPreviewImage || !state.patternAdjustPreviewGrid?.length) return;
  const maxSide = Math.max(state.patternAdjustPreviewGrid.length, state.patternAdjustPreviewGrid[0]?.length || 1);
  const cell = maxSide > 120 ? 5 : maxSide > 80 ? 8 : 12;
  els.patternAdjustPreviewImage.src = createChartCanvas(
    state.patternAdjustPreviewGrid,
    calculateStats(state.patternAdjustPreviewGrid),
    { cell, margin: 24, showLegend: false, showCodes: true },
  ).toDataURL("image/png");
}

function createAdjustedPattern(sourceGrid, adjustments) {
  const palette = getEditorPalette();
  const brightness = adjustments.brightness * 1.15;
  const exposureFactor = 2 ** (adjustments.exposure / 100);
  const contrastFactor = (259 * (adjustments.contrast + 255)) / (255 * (259 - adjustments.contrast));
  const saturationFactor = 1 + adjustments.saturation / 100;
  const sharpenAmount = Math.min(0.65, adjustments.sharpen / 150);
  return sourceGrid.map((row, y) => row.map((color, x) => {
    if (!color) return null;
    let channels = color.rgb.map((value) => value * exposureFactor + brightness);
    channels = channels.map((value) => contrastFactor * (value - 128) + 128);
    const gray = 0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2];
    channels = channels.map((value) => gray + (value - gray) * saturationFactor);
    if (sharpenAmount > 0) {
      const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
        .map(([nx, ny]) => sourceGrid[ny]?.[nx]?.rgb)
        .filter(Boolean);
      if (neighbors.length) {
        const average = [0, 1, 2].map((channel) => neighbors.reduce((sum, rgbValue) => sum + rgbValue[channel], 0) / neighbors.length);
        channels = channels.map((value, channel) => value + (color.rgb[channel] - average[channel]) * sharpenAmount);
      }
    }
    return cloneColor(nearestColor(...channels.map((value) => clamp(value, 0, 255)), palette, { importance: 0.8, region: "subject" }));
  }));
}

function applyPatternAdjustment() {
  if (!state.patternAdjustBase) return;
  window.cancelAnimationFrame(state.patternAdjustFrame);
  const before = cloneGrid(state.patternAdjustBase);
  const after = createAdjustedPattern(before, getPatternAdjustments());
  state.replaceUndo.push(gridToUndoAction(before));
  if (state.patternAdjustTarget === "main") {
    state.grid = cloneGrid(after);
    state.editorGrid = cloneGrid(after);
    state.stats = calculateStats(state.grid);
    state.generationOriginalGrid = null;
    state.generationOptimizedGrid = null;
    refreshChartUrl();
    updateResultUi();
    updateOptimizationToggle();
  } else {
    state.editorGrid = cloneGrid(after);
    updateReplaceOptions();
    updateEditorControls();
    renderEditorCanvas();
  }
  state.patternAdjustBase = null;
  state.patternAdjustPreviewGrid = null;
  els.patternAdjustModal?.close();
  setStatus("已应用图纸调节");
}

function cancelPatternAdjustmentPreview() {
  if (!state.patternAdjustBase) return;
  window.cancelAnimationFrame(state.patternAdjustFrame);
  state.patternAdjustBase = null;
  state.patternAdjustPreviewGrid = null;
}

function openGridAlignDialog() {
  if (!state.editorReference) {
    window.alert("请先添加参考图。");
    return;
  }
  const reference = state.editorReference;
  state.gridAlignBase = { ...reference, image: undefined };
  els.gridOffsetX.value = String(reference.gridOffsetX || 0);
  els.gridOffsetY.value = String(reference.gridOffsetY || 0);
  els.gridCellWidth.value = String(reference.gridCellWidth || getEditorRenderCellSize());
  els.gridCellHeight.value = String(reference.gridCellHeight || getEditorRenderCellSize());
  reference.showAlignment = true;
  renderEditorCanvas();
  els.gridAlignModal?.showModal();
}

function previewGridAlignment() {
  const reference = state.editorReference;
  if (!reference) return;
  reference.gridOffsetX = Number(els.gridOffsetX.value || 0);
  reference.gridOffsetY = Number(els.gridOffsetY.value || 0);
  reference.gridCellWidth = Math.max(1, Number(els.gridCellWidth.value || 1));
  reference.gridCellHeight = Math.max(1, Number(els.gridCellHeight.value || 1));
  reference.showAlignment = true;
  renderEditorCanvas();
}

function autoEstimateReferenceGrid() {
  const reference = state.editorReference;
  const image = state.editorReferenceImage;
  if (!reference || !image) return;
  const width = Math.min(600, image.naturalWidth || image.width);
  const height = Math.min(600, image.naturalHeight || image.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const vertical = new Float64Array(width);
  const horizontal = new Float64Array(height);
  for (let y = 1; y < height; y += 1) for (let x = 1; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const left = i - 4;
    const above = i - width * 4;
    vertical[x] += Math.abs(pixels[i] - pixels[left]) + Math.abs(pixels[i + 1] - pixels[left + 1]) + Math.abs(pixels[i + 2] - pixels[left + 2]);
    horizontal[y] += Math.abs(pixels[i] - pixels[above]) + Math.abs(pixels[i + 1] - pixels[above + 1]) + Math.abs(pixels[i + 2] - pixels[above + 2]);
  }
  const estimatePeriod = (projection, expected) => {
    let best = Math.max(2, expected);
    let bestScore = -Infinity;
    for (let period = Math.max(2, Math.floor(expected * 0.55)); period <= Math.ceil(expected * 1.55); period += 1) {
      let score = 0;
      for (let i = period; i < projection.length; i += 1) score += projection[i] * projection[i - period];
      if (score > bestScore) { bestScore = score; best = period; }
    }
    return best;
  };
  const columns = state.editorGrid[0]?.length || 1;
  const rows = state.editorGrid.length || 1;
  const sourceCellWidth = estimatePeriod(vertical, width / columns);
  const sourceCellHeight = estimatePeriod(horizontal, height / rows);
  reference.gridCellWidth = sourceCellWidth * (columns * getEditorRenderCellSize()) / width;
  reference.gridCellHeight = sourceCellHeight * (rows * getEditorRenderCellSize()) / height;
  els.gridCellWidth.value = reference.gridCellWidth.toFixed(2);
  els.gridCellHeight.value = reference.gridCellHeight.toFixed(2);
  els.gridAlignMessage.textContent = "已根据水平/垂直梯度周期估算，请检查叠加线后微调。";
  previewGridAlignment();
}

function applyGridAlignment() {
  previewGridAlignment();
  if (state.editorReference) state.editorReference.showAlignment = false;
  state.gridAlignBase = null;
  renderEditorCanvas();
  els.gridAlignModal?.close();
  setStatus("已保存参考图网格对齐");
}

function cancelGridAlignmentPreview() {
  if (!state.gridAlignBase || !state.editorReference) return;
  Object.assign(state.editorReference, state.gridAlignBase, { showAlignment: false });
  state.gridAlignBase = null;
  renderEditorCanvas();
}

function drawReferenceAlignmentOverlay(context, margin, cell, columns, rows) {
  const reference = state.editorReference;
  if (!reference?.showAlignment || reference.visible === false) return;
  const width = columns * cell;
  const height = rows * cell;
  const cellWidth = Math.max(1, reference.gridCellWidth || cell);
  const cellHeight = Math.max(1, reference.gridCellHeight || cell);
  context.save();
  context.strokeStyle = "rgba(0, 122, 255, 0.78)";
  context.lineWidth = 1;
  for (let x = reference.gridOffsetX % cellWidth; x <= width; x += cellWidth) {
    context.beginPath(); context.moveTo(margin + x, margin); context.lineTo(margin + x, margin + height); context.stroke();
  }
  for (let y = reference.gridOffsetY % cellHeight; y <= height; y += cellHeight) {
    context.beginPath(); context.moveTo(margin, margin + y); context.lineTo(margin + width, margin + y); context.stroke();
  }
  context.restore();
}

function trimEditorArtwork() {
  const bounds = getGridContentBounds(state.editorGrid);
  if (!bounds) return;
  const oldGrid = cloneGrid(state.editorGrid);
  state.editorGrid = state.editorGrid
    .slice(bounds.y0, bounds.y1 + 1)
    .map((row) => row.slice(bounds.x0, bounds.x1 + 1).map(cloneColor));
  state.replaceUndo.push(gridToUndoAction(oldGrid));
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function getGridContentBounds(grid) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  grid.forEach((row, y) => {
    row.forEach((color, x) => {
      if (!color) return;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    });
  });
  return x1 >= 0 ? { x0, y0, x1, y1 } : null;
}

function fitEditorToScreen() {
  const wrap = els.editorCanvas?.parentElement;
  const canvas = els.editorCanvas;
  if (!wrap || !canvas) return;
  const scaleX = (wrap.clientWidth - 44) / canvas.width;
  const scaleY = (wrap.clientHeight - 44) / canvas.height;
  setEditorZoom(clamp(Math.min(scaleX, scaleY), 0.35, 3));
}

function clearEditorArtwork() {
  if (!window.confirm("确认清空当前画布？")) return;
  const oldGrid = cloneGrid(state.editorGrid);
  state.editorGrid = state.editorGrid.map((row) => row.map(() => null));
  state.replaceUndo.push(gridToUndoAction(oldGrid));
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function replaceColor() {
  const fromCode = els.replaceFrom.value;
  if (!fromCode) return;
  const toCode = els.replaceTo.value;
  const target = toCode ? getEditorPalette().find((color) => color.code === toCode) : null;
  const action = [];

  state.editorGrid.forEach((row, y) => {
    row.forEach((color, x) => {
      if (color?.code === fromCode) {
        action.push({ x, y, oldColor: cloneColor(color) });
        state.editorGrid[y][x] = cloneColor(target);
      }
    });
  });

  if (!action.length) return;
  state.replaceUndo.push(action);
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function undoReplace() {
  const action = state.replaceUndo.pop();
  if (!action) return;
  if (action.fullGrid) {
    state.editorGrid = cloneGrid(action.fullGrid);
    renderEditorCanvas();
    updateReplaceOptions();
    updateEditorControls();
    return;
  }
  for (const item of action) {
    state.editorGrid[item.y][item.x] = cloneColor(item.oldColor);
  }
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function saveEditor() {
  state.grid = cloneGrid(state.editorGrid);
  state.manualEdited = true;
  state.width = state.grid[0]?.length || 0;
  state.height = state.grid.length;
  if (els.artworkNameInput?.value.trim()) {
    state.sourceName = els.artworkNameInput.value.trim();
  }
  state.paletteLabel = getPaletteLabelForKey(els.editorPaletteSelect.value);
  state.stats = calculateStats(state.grid);
  state.assemblyHideCellText = false;
  refreshChartUrl();
  updateResultUi();
  saveCurrentToGallery();
  window.dispatchEvent(new Event("libms:legacy-editor-saved"));
  window.dispatchEvent(new CustomEvent("libms:project-result", { detail: window.LibmsWorkspaceBridge?.getResult() }));
  els.editorModal.close();
}

function saveEditorToLibrary() {
  state.grid = cloneGrid(state.editorGrid);
  state.manualEdited = true;
  state.width = state.grid[0]?.length || 0;
  state.height = state.grid.length;
  if (els.artworkNameInput?.value.trim()) {
    state.sourceName = els.artworkNameInput.value.trim();
  }
  state.paletteLabel = getPaletteLabelForKey(els.editorPaletteSelect.value);
  state.stats = calculateStats(state.grid);
  state.assemblyHideCellText = false;
  refreshChartUrl();
  updateResultUi();
  saveCurrentToGallery();
  window.dispatchEvent(new Event("libms:legacy-editor-saved"));
  window.dispatchEvent(new CustomEvent("libms:project-result", { detail: window.LibmsWorkspaceBridge?.getResult() }));
  setStatus("已保存到作品库");
}

function startAssemblyMode() {
  saveEditorToLibrary();
  state.assemblyMode = true;
  state.editorTool = "pencil";
  state.assemblyHighlightCode = state.stats[0]?.code || "";
  updateAssemblyUi();
  updateEditorToolUi();
  renderPaletteGroups();
  renderEditorCanvas();
  setStatus("拼豆对照模式");
}

function updateAssemblyUi() {
  els.editorModal?.classList.toggle("assembly-mode", state.assemblyMode);
  if (els.editorTitle) {
    els.editorTitle.textContent = state.assemblyMode ? "拼豆对照模式" : "画板修改";
  }
  if (els.assemblyModeButton) {
    els.assemblyModeButton.textContent = state.assemblyMode ? "对照模式中" : "开始拼豆";
  }
}

function downloadEditorArtwork() {
  const stats = calculateStats(state.editorGrid);
  const canvas = createChartCanvas(state.editorGrid, stats, {
    cell: getDownloadCellSize(),
    margin: 88,
    showCodes: true,
    minLongSide: EXPORT_MIN_LONG_SIDE,
    subtitle: "编辑器导出",
  });
  const base = (els.artworkNameInput?.value || state.sourceName || "bead-pattern")
    .replace(/\.[^.]+$/, "")
    .trim();
  downloadUrl(canvas.toDataURL("image/png"), `${base || "bead-pattern"}-editor.png`);
  setStatus("已下载编辑图纸");
}

function publishEditorArtwork() {
  saveEditorToLibrary();
  window.alert("社区发布需要账号与服务器接口。当前已先保存到本地作品库。");
}

function openBlankBoardDialog() {
  updateBlankBoardSummary();
  els.blankBoardModal?.showModal();
}

// 只判断合法性，不做夹取：填 10 就是 10，填 1 就是 1，不再悄悄改成 16 或 1000。
function parseBlankBoardSize(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text) return null;
  const value = Math.round(Number(text));
  if (!Number.isFinite(value)) return null;
  if (value < BLANK_BOARD_MIN || value > BLANK_BOARD_MAX) return null;
  return value;
}

function updateBlankBoardSummary() {
  const width = parseBlankBoardSize(els.blankBoardWidth?.value);
  const height = parseBlankBoardSize(els.blankBoardHeight?.value);
  const valid = width !== null && height !== null;
  if (els.blankBoardSummary) {
    els.blankBoardSummary.textContent = valid
      ? `${width} × ${height} 空白画板 · ${(width * height).toLocaleString("zh-CN", { useGrouping: false })} 个可编辑格子`
      : "尺寸填写有误 · 不会按其他数值创建画板";
  }
  if (els.blankBoardMessage) {
    els.blankBoardMessage.textContent = valid
      ? `可填 ${BLANK_BOARD_MIN} 到 ${BLANK_BOARD_MAX} 之间的整数：填多少就创建多少，最小 ${BLANK_BOARD_MIN} × ${BLANK_BOARD_MIN}。`
      : `宽度和高度都必须填 ${BLANK_BOARD_MIN} 到 ${BLANK_BOARD_MAX} 之间的整数。已填写的内容不会被自动改写，改好之后才能创建。`;
  }
  [[els.blankBoardWidth, width], [els.blankBoardHeight, height]].forEach(([input, value]) => {
    input?.setAttribute("aria-invalid", value === null ? "true" : "false");
  });
  if (els.createBlankBoardButton) els.createBlankBoardButton.disabled = !valid;
}

function createBlankBoard(options = {}) {
  const { openEditorAfterCreate = true } = options;
  const fallbackSize = getGranularity();
  const width = parseBlankBoardSize(options.width ?? fallbackSize);
  const height = parseBlankBoardSize(options.height ?? fallbackSize);
  if (width === null || height === null) {
    updateBlankBoardSummary();
    if (els.blankBoardMessage) {
      els.blankBoardMessage.textContent = `宽度和高度都必须填 ${BLANK_BOARD_MIN} 到 ${BLANK_BOARD_MAX} 之间的整数，因此没有创建画板。`;
    }
    return false;
  }
  state.sourceDataUrl = "";
  state.sourceName = "blank-board";
  state.autoProcessAfterLoad = false;
  state.restoreAutoSizePending = false;
  state.backgroundDecision = "";
  state.paletteBudget = null;
  state.sourceSafetyChecked = true;
  els.fileInput.value = "";
  els.sourcePreview.hidden = true;
  els.sourcePreview.removeAttribute("src");
  els.uploadZone.classList.remove("has-image", "drag-over");
  state.grid = Array.from({ length: height }, () => Array(width).fill(null));
  state.width = width;
  state.height = height;
  state.paletteLabel = getCurrentPaletteLabel();
  state.stats = [];
  state.assemblyHideCellText = false;
  refreshChartUrl();
  updateResultUi();
  setStatus(`${width} × ${height} 空白画板`);
  els.blankBoardModal?.close();
  if (openEditorAfterCreate) openEditor();
  return true;
}

function resetAll() {
  state.sourceDataUrl = "";
  state.sourceName = "";
  state.autoProcessAfterLoad = false;
  state.restoreAutoSizePending = false;
  state.backgroundDecision = "";
  state.sourceSafetyChecked = false;
  els.fileInput.value = "";
  els.sourcePreview.hidden = true;
  els.sourcePreview.removeAttribute("src");
  els.uploadZone.classList.remove("has-image", "drag-over");
  els.processButton.disabled = true;
  clearResult();
  setStatus("待上传");
}

function clearResult() {
  state.grid = [];
  state.manualEdited = false;
  state.stats = [];
  state.paletteEngine = null;
  state.chartUrl = "";
  state.previewUrl = "";
  state.paletteLabel = "";
  state.backgroundDecision = "";
  state.paletteBudget = null;
  state.width = 0;
  state.height = 0;
  state.assemblyHideCellText = false;
  updateResultUi();
}

function setStatus(text) {
  els.statusPill.textContent = text;
}

function cloneColor(color) {
  return color ? { ...color, rgb: [...color.rgb] } : null;
}

function cloneGrid(grid) {
  return grid.map((row) => row.map(cloneColor));
}

function sameColor(a, b) {
  return a?.code === b?.code || (!a && !b);
}

function rgb(color) {
  return color.hex || `rgb(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]})`;
}

function isDark(rgbValue) {
  return (0.299 * rgbValue[0] + 0.587 * rgbValue[1] + 0.114 * rgbValue[2]) / 255 < 0.5;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Read-only instrumentation for UI refactor regression capture; generation is unchanged.
window.captureLegacyGenerationBaseline = () => ({
  width: state.width,
  height: state.height,
  palette: getCurrentPaletteKey(),
  maxColors: state.paletteBudget?.effective ?? null,
  usedColors: state.stats.length,
  totalBeads: state.stats.reduce((sum, item) => sum + item.count, 0),
  paletteCodeDistribution: Object.fromEntries(state.stats.map((item) => [item.code, item.count])),
  matrix: state.grid.map((row) => row.map((color) => color?.code || null)),
});

// Thin UI adapter: existing Color Grid, palette and generation functions remain authoritative.
window.LibmsWorkspaceBridge = {
  getResult: () => ({
    width: state.width, height: state.height, grid: state.grid, colors: state.stats,
    usedColors: state.stats.length, totalBeads: state.stats.reduce((sum, color) => sum + color.count, 0),
    sourceUrl: state.processedSourceDataUrl || state.sourceDataUrl, sourceOriginalUrl: state.sourceDataUrl, sourceName: state.sourceName, sourceWidth: state.sourceNaturalWidth, sourceHeight: state.sourceNaturalHeight, previewUrl: state.previewUrl,
    patternUrl: state.chartUrl, paletteKey: getCurrentPaletteKey(),
    maxColors: Number(els.maxColorsInput?.value || 0), manualEdited: state.manualEdited,
    algorithmEngine: state.algorithmEngine, algorithmEngineLast: state.algorithmEngineLast || null,
  }),
  getCell(x, y) { return cloneColor(state.grid[y]?.[x] || null); },
  // 上一次生成的「智能辅助」运行报告：给验收脚本与排障用，不参与任何计算。
  getGenerationReport: () => ({
    engine: state.generationEngineLast || null,
    algorithmEngine: state.algorithmEngineLast || null,
    pindo: state.pindoReport || null,
    bgs: state.bgsReport || null,
    smartFeatures: state.smartFeatures || null,
    subjectCrop: state.smartReport?.subjectCrop || null,
    autoBackground: state.smartReport?.autoBackground || null,
    strokeProtection: state.smartReport?.strokeProtection || null,
    accentProtection: state.smartReport?.accentProtection || null,
    paletteBudget: state.paletteBudget || null,
    generationMilliseconds: state.generationMilliseconds ?? null,
  }),
  getPaletteColors: () => getCurrentPalette().map(cloneColor),
  applyCellChanges(changes, { live = false, finalize = false } = {}) {
    if (!state.grid.length || !Array.isArray(changes)) return 0;
    let count = 0;
    for (const change of changes) {
      const x = Number(change.x), y = Number(change.y);
      if (!Number.isInteger(x) || !Number.isInteger(y) || !state.grid[y] || x < 0 || x >= state.grid[y].length) continue;
      const next = change.after ? cloneColor(change.after) : null;
      if (state.grid[y][x]?.code === next?.code) continue;
      state.grid[y][x] = next;
      count++;
    }
    if (count) state.manualEdited = true;
    if ((count || finalize) && !live) {
      state.manualEdited = true;
      state.stats = calculateStats(state.grid);
      if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) document.body.dataset.canonicalBaseline = JSON.stringify(window.captureLegacyGenerationBaseline());
      refreshChartUrl();
      updateResultUi();
      window.dispatchEvent(new CustomEvent("libms:grid-edited", { detail: this.getResult() }));
    }
    return count;
  },
  setProductionOptions({ engine = "v2.5", generationOptions = {} } = {}) {
    state.generationEngine = engine;
    state.productionGenerationOptions = generationOptions;
  },
  async generate({ width, height, maxColors, overwriteApproved = false } = {}) {
    state.lastGenerationError = "";
    if (width != null) syncRangeControls("granularity", width, 10, 500);
    if (height != null) state.targetHeight = clamp(Math.round(Number(height) || 50), 10, 500);
    if (maxColors != null && els.maxColorsInput) els.maxColorsInput.value = String(maxColors);
    const generated = await processImage({ overwriteApproved });
    if (!generated && state.lastGenerationError) {
      // 独立算法失败时保留原算法选择，不静默回退。
      if (state.algorithmEngine === "bgs") throw new Error(`BGS 算法失败：${state.lastGenerationError}`);
      if (state.algorithmEngine === "pindou-workbench" || state.algorithmEngine === "hybrid-pw") {
        throw new Error(`PW 算法失败：${state.lastGenerationError}`);
      }
      throw new Error(`V2.5 失败：${state.lastGenerationError}。请选择 Legacy 重试。`);
    }
    return generated ? this.getResult() : null;
  },
  setGenerationEngine(engine) { state.generationEngine = engine === "legacy" ? "legacy" : "v2.5"; },
  // ===== 算法引擎开关（Batch E + F）=====
  // current = 现有链路；bgs = src/algorithms/bgs；
  // pindou-workbench / hybrid-pw = src/algorithms/pindou-workbench。
  // 注：此前的 pindo-native（LunarXuan/Pindo 的 JS 移植，GPL-3.0-only）已剥离出仓库，
  // 不随本站分发；备份见仓库外 libms-studio-GPL-quarantine/。
  setAlgorithmEngine(engine) {
    state.algorithmEngine = ALGORITHM_ENGINES.has(engine) ? engine : "current";
    window.dispatchEvent(new CustomEvent("libms:algorithm-engine-changed", { detail: state.algorithmEngine }));
    return state.algorithmEngine;
  },
  getAlgorithmEngine: () => state.algorithmEngine,
  getAlgorithmEngines: () => [...ALGORITHM_ENGINES],
  /** 上一次 PW / HYBRID-PW 运行的报告。没跑过就是 null。 */
  getPwReport: () => (state.pwReport ? JSON.parse(JSON.stringify(state.pwReport)) : null),
  /** 色板匹配档位：original-weighted-rgb / lab / ciede2000。只影响 pw 两个引擎。 */
  setPaletteMatchMode(mode) {
    const allowed = new Set(["original-weighted-rgb", "lab", "ciede2000"]);
    state.pwPaletteMatchMode = allowed.has(mode) ? mode : "ciede2000";
    return state.pwPaletteMatchMode;
  },
  getPaletteMatchMode: () => state.pwPaletteMatchMode,
  /** 上一次 BGS 运行的完整报告（统计 + 诊断）。没跑过就是 null，不参与任何计算。 */
  getAlgorithmReport: () => (state.bgsReport ? JSON.parse(JSON.stringify(state.bgsReport)) : null),
  /**
   * A/B 对比：同一张源图、同一套尺寸/色板/颜色上限，分别跑两个引擎。
   *
   * current 一侧用的就是生产链路的 generateV2 + buildV25Options（不是手抄的副本），
   * 两侧共享**同一份 imageData**，所以差异只来自算法本身。
   *
   * 返回 verdict 恒为 null —— 本工具只输出 6 项指标 + 两个矩阵 + 逐格差异，不替用户选赢家。
   */
  async runAlgorithmAbTest({ includeMatrix = true, options = {} } = {}) {
    if (!state.sourceDataUrl) throw new Error("请先上传图片");
    const [{ compareEngines, normalizeMatrix, renderMatrixAsBlockArt }, { generateV2 }] = await Promise.all([
      import(`./src/algorithms/bgs/ab-test.mjs${BGS_MODULE_QUERY}`),
      import("./smart-preprocessing/generation-engine-v2.mjs?v=20260918-usage2"),
    ]);
    const { image, imageData } = await loadProductionRaster();
    const palette = getCurrentPalette();
    const width = getGranularity();
    const height = getGenerationTargetHeight(image, width);
    const maxColors = clamp(Number(els.maxColorsInput?.value || 0), 0, palette.length);
    const protection = bgsProtectionOptions();

    const report = await compareEngines({
      imageData,
      palette,
      width,
      height,
      options: {
        maxColors,
        preserveAspectRatio: false,
        samplingMode: options.sampling || state.productionGenerationOptions?.sampling || state.generationSampling || "auto",
        edgeProtection: protection.edgeProtection,
        cleanupStrength: protection.cleanupStrength,
        ...bgsAnchorCodes(palette),
      },
      // current 一侧：直接跑生产链路的 V2.5 生成，只取矩阵，不写 state。
      currentRunner: ({ imageData: shared, palette: sharedPalette }) => generateV2({
        source: shared, width, height, palette: sharedPalette, options: buildV25Options(options, maxColors),
      }).grid,
      includeMatrix,
    });

    if (includeMatrix && report.matrices) {
      const prepared = report.palette;
      const current = normalizeMatrix(report.matrices.current, prepared);
      const bgs = normalizeMatrix(report.matrices.bgs, prepared);
      report.blockArt = {
        current: renderMatrixAsBlockArt(current.colorIds, current.cols, current.rows, prepared),
        bgs: renderMatrixAsBlockArt(bgs.colorIds, bgs.cols, bgs.rows, prepared),
      };
      report.legend = prepared.map((entry) => `${entry.code}=${entry.hex}`);
    }
    return report;
  },
  /**
   * 算法实验室（Batch F）：同一张图、同一套尺寸/色板/颜色上限，
   * 并排跑 CURRENT / PW ORIGINAL / HYBRID-PW 三路，输出十项指标。
   *
   * 铁律：**不判定哪套最好**。`verdict` 恒为 null，报告里没有 winner / 评分 /
   * 推荐，三套结果原样并排交给使用者人工判断。
   *
   * 不写 state —— 实验室只测量，不替换当前图纸。
   */
  async runPwLab({ includeBlockArt = true, width, height, maxColors } = {}) {
    if (!state.sourceDataUrl) throw new Error("请先上传图片");
    const [{ runAlgorithmLab, renderLabReport }, { generateV2 }] = await Promise.all([
      import(`./src/algorithms/pindou-workbench/index.js${PW_MODULE_QUERY}`),
      import("./smart-preprocessing/generation-engine-v2.mjs?v=20260918-usage2"),
    ]);
    const { image, imageData } = await loadProductionRaster();
    const palette = getCurrentPalette();
    const cols = clamp(Math.round(Number(width) || getGranularity()), 10, 500);
    const rows = clamp(Math.round(Number(height) || getGenerationTargetHeight(image, cols)), 10, 500);
    const limit = clamp(Number(maxColors ?? els.maxColorsInput?.value ?? 0), 0, palette.length);

    const report = await runAlgorithmLab({
      imageData,
      palette,
      width: cols,
      height: rows,
      maxColors: limit,
      includeBlockArt,
      // current 一侧跑的就是生产链路的 V2.5（不是手抄副本），共享同一份 imageData。
      currentRunner: ({ imageData: shared, palette: sharedPalette, width: w, height: h, maxColors: m }) =>
        generateV2({ source: shared, width: w, height: h, palette: sharedPalette, options: buildV25Options({}, m) }).grid,
    });
    // 顺手给出 Markdown 版，方便直接贴进文档/聊天。
    report.markdown = renderLabReport(report);
    return report;
  },
  setWidth(value) { return syncRangeControls("granularity", value, 10, 500); },
  setHeight(value) { state.targetHeight = clamp(Math.round(Number(value) || 50), 10, 500); return state.targetHeight; },
  setLockAspectRatio(value) { state.aspectRatioLocked = Boolean(value); return state.aspectRatioLocked; },
  getSourceTransform: () => ({ ...state.sourceTransform, crop: state.sourceTransform.crop ? { ...state.sourceTransform.crop } : null, expand: { ...state.sourceTransform.expand } }),
  setSourceTransform(patch) {
    state.sourceTransform = { ...state.sourceTransform, ...patch,
      expand: { ...state.sourceTransform.expand, ...(patch.expand || {}) } };
    state.processedSourceDataUrl = "";
    window.dispatchEvent(new CustomEvent("libms:source-transform-changed", { detail: this.getSourceTransform() }));
    return this.getSourceTransform();
  },
  getNearestPaletteCandidates(rgb) {
    const palette = getCurrentPalette(), sourceLab = window.LibmsPaletteEngine?.rgbToLab?.(rgb);
    const candidates = palette.map((color) => ({ ...cloneColor(color), distance: sourceLab
      ? window.LibmsPaletteEngine.deltaE2000(sourceLab, window.LibmsPaletteEngine.rgbToLab(color.rgb))
      : Math.sqrt(color.rgb.reduce((sum, channel, i) => sum + (channel - rgb[i]) ** 2, 0)) }));
    candidates.sort((a,b) => a.distance - b.distance || a.code.localeCompare(b.code));
    const nearest = nearestColor(rgb[0], rgb[1], rgb[2], palette);
    return { nearest: nearest?.code || null, candidates: candidates.slice(0,5) };
  },
  getPalettes: () => Object.keys(PALETTES),
  getActivePalette: () => ({ key: getCurrentPaletteKey(), colors: getCurrentPalette() }),
  setActivePalette(brand, size) {
    if (BRAND_PROFILES[brand]) state.selectedBrand = brand;
    els.brandButtons.forEach((button) => { const active = button.dataset.brand === state.selectedBrand; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    updatePaletteOptions();
    if (size != null && getSelectedBrandProfile().options.includes(Number(size))) els.paletteSelect.value = String(size);
    updateEditorPaletteOptions();
    updatePaletteCount();
    return this.getActivePalette();
  },
  setMaxColors(value) {
    if (els.maxColorsInput) els.maxColorsInput.value = String(value);
    updateMaxColorPresetUi();
  },
  importImage({ overwriteApproved = false } = {}) {
    if (state.manualEdited && !overwriteApproved) return false;
    state.importApproved = overwriteApproved;
    startPhotoImport(); return true;
  },
  getTileSize: () => getSelectedTileSize(),
  getRenderUrl({ mode, showGrid = false, showCodes = false, zoom = 1, highlightedCode = null } = {}) {
    if (mode === "original") return state.sourceDataUrl || state.previewUrl;
    if (!state.grid.length) return "";
    const canShowCodes = Boolean(showCodes && zoom * 12 >= 14);
    if (mode === "pattern") return renderBeadPattern({ matrix: state.grid, stats: state.stats, preset: "PATTERN_EXPORT", cell: 18,
      showGrid, showCodes: canShowCodes, showCoordinates: true, minLongSide: 0 }).toDataURL("image/png");
    const cell = 12;
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    canvas.width = state.width * cell; canvas.height = state.height * cell;
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    state.grid.forEach((row, y) => row.forEach((color, x) => {
      if (!color) return;
      context.globalAlpha = highlightedCode && color.code !== highlightedCode ? 0.2 : 1;
      context.fillStyle = rgb(color);
      if (mode === "beads") {
        context.beginPath(); context.arc(x * cell + cell / 2, y * cell + cell / 2, cell * 0.43, 0, Math.PI * 2); context.fill();
      } else context.fillRect(x * cell, y * cell, cell, cell);
      context.globalAlpha = 1;
      if (showGrid) { context.strokeStyle = "#00000022"; context.strokeRect(x * cell + 0.5, y * cell + 0.5, cell, cell); }
      if (canShowCodes) { context.font = '7px system-ui'; context.textAlign = 'center'; context.fillStyle = isDark(color.rgb) ? '#ffffff' : '#141414'; context.fillText(color.code, x * cell + cell / 2, y * cell + cell * 0.72); }
    }));
    return canvas.toDataURL("image/png");
  },
  downloadPreview: () => downloadPreviewImage(),
  async downloadPattern({ split = false, settings = {} } = {}) {
    const previous = els.tileSizeSelect?.value;
    if (els.tileSizeSelect) els.tileSizeSelect.value = split ? (previous && previous !== "0" ? previous : "52") : "0";
    try { await downloadPattern(settings); } finally { if (els.tileSizeSelect) els.tileSizeSelect.value = previous; }
  },
  openEditor: () => openEditor(),
  openMaking: () => openAssemblyPlayer(),
  // ===== 结构级替换（旋转 / 工程恢复共用）：唯一事实源仍是 state.grid =====
  replaceGridStructure({ grid, width, height } = {}) {
    const nextWidth = Math.round(Number(width) || 0);
    const nextHeight = Math.round(Number(height) || 0);
    if (!Array.isArray(grid) || !grid.length || nextWidth <= 0 || nextHeight <= 0) return false;
    if (grid.length !== nextHeight) return false;
    if (grid.some((row) => !Array.isArray(row) || row.length !== nextWidth)) return false;
    state.grid = grid.map((row) => row.map((color) => (color ? cloneColor(color) : null)));
    state.width = nextWidth;
    state.height = nextHeight;
    state.stats = calculateStats(state.grid);
    state.manualEdited = true;
    refreshChartUrl();
    updateResultUi();
    window.dispatchEvent(new CustomEvent("libms:grid-edited", { detail: this.getResult() }));
    return true;
  },
  renderExportPattern(settings = {}) {
    const exportGrid = getExportGrid();
    return renderBeadPattern({
      matrix: exportGrid,
      stats: calculateStats(exportGrid),
      preset: "PATTERN_EXPORT",
      cell: getDownloadCellSize(),
      margin: 88,
      minLongSide: EXPORT_MIN_LONG_SIDE,
      subtitle: getExportSubtitle(),
      ...(settings.showGrid == null ? {} : { showGrid: settings.showGrid }),
      ...(settings.showCodes == null ? {} : { showCodes: settings.showCodes }),
      ...(settings.showCoordinates == null ? {} : { showCoordinates: settings.showCoordinates }),
    });
  },
  async downloadPatternJpg(settings = {}) {
    if (state.generationEngine !== "v2.5" && !ensureInviteRegistered()) return false;
    if (!state.grid.length) throw new Error("请先生成图纸");
    const canvas = this.renderExportPattern(settings);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("JPG 编码失败"))), "image/jpeg", 0.94);
    });
    downloadBlob(blob, buildPatternDownloadName("jpg"));
    setStatus("已导出 JPG 图纸（含图例）");
    return true;
  },
  downloadUsageCsv() {
    if (!state.grid.length) throw new Error("请先生成图纸");
    const rows = [["色号", "颜色名称", "HEX", "RGB", "颗数"]];
    let total = 0;
    state.stats.forEach((item) => {
      total += item.count;
      rows.push([item.code, item.name || "", item.hex || hexFromRgb(item.rgb), `rgb(${item.rgb.join(",")})`, String(item.count)]);
    });
    rows.push(["合计", "", "", "", String(total)]);
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadBlob(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }), buildPatternDownloadName("csv"));
    setStatus(`已导出用量清单 · ${state.stats.length} 色 / ${formatCount(total)} 颗`);
    return true;
  },
  buildProjectJson() {
    if (!state.grid.length) throw new Error("请先生成图纸");
    return {
      format: "libms-project",
      version: 1,
      savedAt: new Date().toISOString(),
      projectName: getSchemeName() || state.sourceName.replace(/\.[^.]+$/, "") || "未命名作品",
      canvas: { width: state.width, height: state.height },
      palette: { key: getCurrentPaletteKey(), label: getCurrentPaletteLabel(), maxColors: Number(els.maxColorsInput?.value || 0) },
      stats: { usedColors: state.stats.length, totalBeads: state.stats.reduce((sum, item) => sum + item.count, 0) },
      colors: state.stats.map((item) => ({ code: item.code, name: item.name || "", hex: item.hex || hexFromRgb(item.rgb), rgb: [...item.rgb] })),
      grid: state.grid.map((row) => row.map((color) => (color ? color.code : null))),
    };
  },
  downloadProjectJson() {
    const payload = this.buildProjectJson();
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `${payload.projectName}-project.json`);
    setStatus("已保存工程文件");
    return payload;
  },
  loadProjectJson(source) {
    let payload = source;
    if (typeof source === "string") {
      try { payload = JSON.parse(source); } catch { throw new Error("工程文件不是合法 JSON"); }
    }
    if (!payload || typeof payload !== "object") throw new Error("工程文件内容为空");
    if (payload.format !== "libms-project") throw new Error("不是里白造物工程文件");
    if (Number(payload.version) > 1) throw new Error(`工程文件版本 ${payload.version} 高于当前支持的 1`);
    const width = Math.round(Number(payload.canvas?.width) || 0);
    const height = Math.round(Number(payload.canvas?.height) || 0);
    if (!width || !height || !Array.isArray(payload.grid) || payload.grid.length !== height) {
      throw new Error("工程文件缺少可用的画布尺寸或矩阵");
    }
    // 色号优先按当前色卡解析；跨色卡打开时用存档里的颜色信息兜底，避免丢豆子。
    const archived = new Map((payload.colors || []).map((color) => [String(color.code).toUpperCase(), color]));
    const active = new Map(getCurrentPalette().map((color) => [color.code.toUpperCase(), color]));
    const resolve = (code) => {
      if (code == null) return null;
      const key = String(code).toUpperCase();
      const found = active.get(key) || archived.get(key);
      return found ? cloneColor(found) : null;
    };
    const grid = payload.grid.map((row) => {
      if (!Array.isArray(row) || row.length !== width) throw new Error("工程文件矩阵宽高与画布尺寸不一致");
      return row.map(resolve);
    });
    if (!this.replaceGridStructure({ grid, width, height })) throw new Error("工程文件无法载入当前画布");
    if (payload.palette?.maxColors != null && els.maxColorsInput) els.maxColorsInput.value = String(payload.palette.maxColors);
    return this.getResult();
  },
  getChecks: () => ({ validation: state.grid.length ? window.LibmsRegionAwareQuantizer?.validateFinalPattern?.(state.grid, state.paletteBudget?.effective || 291) : null,
    structural: state.structuralTransitionReport?.metrics || null }),
};

init();

// ===== PDF Export (added by liStudio upgrade) =====
document.getElementById('pdf-export-button')?.addEventListener('click', async function() {
  const previewImg = document.getElementById('result-preview');
  if (!previewImg || previewImg.hidden) {
    alert('请先生成图纸');
    return;
  }
  
  try {
    this.textContent = '正在生成 PDF...';
    this.disabled = true;
    
    // Dynamically load jspdf
    const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm');
    
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    
    // Page 1: cover with material info
    doc.setFontSize(22);
    doc.text('拼豆电子图纸 - 精确材料清单', 20, 25);
    
    // Try to get color data from the app state
    const colorCounts = window.__libms_colorData || [];
    doc.setFontSize(12);
    doc.text('生成时间: ' + new Date().toLocaleString(), 20, 35);
    doc.text('颜色数量: ' + (colorCounts.length || '--') + ' 色', 20, 42);
    
    if (colorCounts.length > 0) {
      let y = 55;
      doc.setFontSize(11);
      doc.text('色号', 25, y);
      doc.text('颜色', 60, y);
      doc.text('数量', 110, y);
      doc.line(20, y + 2, 190, y + 2);
      y += 10;
      
      for (let i = 0; i < colorCounts.length; i++) {
        if (y > 270) { doc.addPage(); y = 20; }
        const c = colorCounts[i];
        doc.text('C' + (i + 1), 25, y);
        doc.text(c.count + ' 颗', 110, y);
        if (c.hex) {
          doc.setFillColor(
            parseInt(c.hex.slice(1,3), 16),
            parseInt(c.hex.slice(3,5), 16),
            parseInt(c.hex.slice(5,7), 16)
          );
          doc.rect(60, y - 4, 12, 5, 'F');
        }
        y += 8;
      }
    }
    
    // Add pages with the generated pattern image
    const canvas = document.createElement('canvas');
    canvas.width = previewImg.naturalWidth || previewImg.width;
    canvas.height = previewImg.naturalHeight || previewImg.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(previewImg, 0, 0);
    const imgData = canvas.toDataURL('image/png');
    
    doc.addPage();
    doc.setFontSize(14);
    doc.text('生成图纸', 20, 15);
    doc.addImage(imgData, 'PNG', 15, 25, 180, 180);
    
    doc.save('libms_pattern_project.pdf');
    
  } catch (err) {
    console.error('PDF export error:', err);
    alert('PDF 导出失败: ' + err.message);
  } finally {
    this.textContent = '📄 导出 PDF（含材料清单）';
    this.disabled = false;
  }
});

/* =============================================================
 * 高级导出设置弹窗（借鉴 pixel-bead.rootbit.cn 导出设置结构）
 * 视觉用 animal-island 薄荷青语言；逻辑自带渲染 + 后处理，
 * 不改动现有 downloadPattern 算法。
 * ============================================================= */
let exportCurrentFormat = "png";
let exportShareCode = "";
let exportBound = false;

function genShareCode() {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i += 1) s += cs[Math.floor(Math.random() * cs.length)];
  return s;
}

function readExportSettings() {
  const $ = (id) => document.getElementById(id);
  return {
    format: exportCurrentFormat,
    name: ($("export-name-input")?.value || "里白造物图纸").trim() || "里白造物图纸",
    author: ($("export-author-input")?.value || "").trim(),
    grid: $("opt-grid")?.checked !== false,
    codes: $("opt-codes")?.checked !== false,
    legend: $("opt-legend")?.checked !== false,
    watermark: $("opt-watermark")?.checked === true,
    qrcode: $("opt-qrcode")?.checked === true,
    sharecode: $("opt-sharecode")?.checked === true,
  };
}

function getExportGridForSettings() {
  const base = getExportGrid();
  if (!base.length) return base;
  return isMirrorEnabled() ? mirrorGrid(base) : base;
}

function buildExportRenderOptions(grid, stats, settings) {
  const isPoster = settings.format === "poster";
  return {
    matrix: grid,
    stats,
    preset: "PATTERN_EXPORT",
    cell: getDownloadCellSize(),
    margin: isPoster ? 40 : 88,
    minLongSide: EXPORT_MIN_LONG_SIDE,
    title: settings.name || "里白造物拼豆图纸生成器",
    subtitle: getExportSubtitle(),
    showGrid: settings.grid && !isPoster,
    showCoordinates: settings.grid && !isPoster,
    showCodes: settings.codes,
    showLegend: settings.legend,
  };
}

function applyExportOverlays(canvas, settings) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  // 防盗网格水印：平铺极淡字样
  if (settings.watermark) {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = "#5a4631";
    const fs = Math.max(16, Math.round(W / 42));
    ctx.font = `700 ${fs}px ${CANVAS_FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 9);
    const text = "里白造物 LIBMS";
    const stepX = ctx.measureText(text).width + fs * 3;
    const stepY = fs * 5;
    for (let y = -H; y < H; y += stepY) {
      for (let x = -W; x < W; x += stepX) ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  // 右下角信息块：二维码 + 豆号 + 署名
  const pad = Math.round(W * 0.02);
  let blockRight = W - pad;
  const blockBottom = H - pad;
  if (settings.qrcode && typeof window.qrcode === "function") {
    try {
      const qr = window.qrcode(0, "M");
      const payload = `libms://import/${exportShareCode || genShareCode()}`;
      qr.addData(payload);
      qr.make();
      const count = qr.getModuleCount();
      const qsize = Math.round(Math.min(W, H) * 0.15);
      const qx = blockRight - qsize;
      const qy = blockBottom - qsize;
      ctx.fillStyle = "#fffdf7";
      ctx.fillRect(qx - 6, qy - 6, qsize + 12, qsize + 12);
      const cell = qsize / count;
      ctx.fillStyle = "#5a4631";
      for (let r = 0; r < count; r += 1) {
        for (let c = 0; c < count; c += 1) {
          if (qr.isDark(r, c)) ctx.fillRect(qx + c * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell));
        }
      }
      blockRight = qx - pad;
    } catch (err) {
      console.warn("二维码生成失败", err);
    }
  }
  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#5a4631";
  const fs2 = Math.max(14, Math.round(W / 48));
  let ty = blockBottom;
  if (settings.sharecode) {
    ctx.font = `700 ${fs2}px ${CANVAS_FONT_STACK}`;
    ctx.fillText(`豆号 ${exportShareCode || ""}`, blockRight, ty);
    ty -= fs2 * 1.4;
  }
  if (settings.author) {
    ctx.font = `400 ${Math.round(fs2 * 0.9)}px ${CANVAS_FONT_STACK}`;
    ctx.fillText(`作者 ${settings.author}`, blockRight, ty);
  }
  ctx.restore();
}

function renderExportPreview() {
  const modal = document.getElementById("export-settings-modal");
  if (!modal || !modal.open) return;
  const grid = getExportGridForSettings();
  const stage = document.getElementById("export-preview-stage");
  if (!grid.length) {
    if (stage) stage.innerHTML = '<p style="color:var(--muted);padding:20px;text-align:center">请先生成或上传一张图纸，再预览导出效果。</p>';
    return;
  }
  const stats = calculateStats(grid);
  const settings = readExportSettings();
  const canvas = renderBeadPattern(buildExportRenderOptions(grid, stats, settings));
  if (settings.watermark || settings.qrcode || settings.author || settings.sharecode) {
    applyExportOverlays(canvas, settings);
  }
  if (stage) {
    stage.innerHTML = "";
    canvas.id = "export-preview-canvas";
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
    stage.appendChild(canvas);
  }
  updateExportSpecs(grid, stats, settings);
}

function updateExportSpecs(grid, stats, settings) {
  const cols = grid[0]?.length || 0;
  const rows = grid.length;
  const sz = document.getElementById("spec-size");
  const cl = document.getElementById("spec-colors");
  const op = document.getElementById("spec-output");
  if (sz) sz.textContent = `${cols} × ${rows}`;
  if (cl) cl.textContent = `${stats.length} 色`;
  if (op) op.textContent = settings.format === "pdf" ? "A4 多页 PDF" : settings.format === "poster" ? "标准 PNG 海报" : "标准 PNG 大图";
}

function setExportFormat(fmt) {
  exportCurrentFormat = fmt;
  document.querySelectorAll(".export-tab").forEach((t) => {
    const on = t.dataset.format === fmt;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  renderExportPreview();
}

function openExportSettingsModal() {
  const modal = document.getElementById("export-settings-modal");
  if (!modal) return;
  bindExportSettingsOnce();
  if (!modal.open) {
    try { modal.showModal(); } catch (err) { console.warn("导出设置弹窗不可用", err); }
  }
  if (!exportShareCode) exportShareCode = genShareCode();
  renderExportPreview();
  document.getElementById("export-settings-close")?.focus();
}

function closeExportSettingsModal() {
  const modal = document.getElementById("export-settings-modal");
  if (modal?.open) modal.close();
}

async function exportWithSettings() {
  const settings = readExportSettings();
  if (settings.format === "pdf") {
    closeExportSettingsModal();
    downloadA4PrintPattern();
    return;
  }
  if (state.generationEngine !== "v2.5" && !ensureInviteRegistered()) {
    closeExportSettingsModal();
    return;
  }
  const grid = getExportGridForSettings();
  if (!grid.length) {
    setStatus("请先生成或上传一张图纸，再导出");
    return;
  }
  const stats = calculateStats(grid);
  const canvas = renderBeadPattern(buildExportRenderOptions(grid, stats, settings));
  if (settings.watermark || settings.qrcode || settings.author || settings.sharecode) {
    applyExportOverlays(canvas, settings);
  }
  const base = buildDownloadName().replace(/\.png$/i, "");
  const suffix = settings.format === "poster" ? "-poster" : "-export";
  downloadUrl(canvas.toDataURL("image/png"), `${base}${suffix}.png`);
  setStatus("已按导出设置生成图纸");
  closeExportSettingsModal();
}

function bindExportSettingsOnce() {
  if (exportBound) return;
  exportBound = true;
  const modal = document.getElementById("export-settings-modal");
  document.getElementById("open-export-settings-button")?.addEventListener("click", openExportSettingsModal);
  document.getElementById("export-settings-close")?.addEventListener("click", closeExportSettingsModal);
  modal?.addEventListener("click", (e) => { if (e.target === modal) closeExportSettingsModal(); });
  document.querySelectorAll(".export-tab").forEach((t) => t.addEventListener("click", () => setExportFormat(t.dataset.format)));
  document.getElementById("export-submit-button")?.addEventListener("click", exportWithSettings);
  ["opt-grid", "opt-codes", "opt-legend", "opt-watermark", "opt-qrcode", "opt-sharecode"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", renderExportPreview);
  });
  ["export-name-input", "export-author-input"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderExportPreview);
  });
}

// 页面加载即绑定一次（defer 保证 DOM ready）；不可放在 openExportSettingsModal 内惰性绑定，
// 否则首次点击入口按钮时监听器尚不存在，弹窗打不开。
bindExportSettingsOnce();
