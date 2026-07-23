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

const DEFAULT_GRANULARITY = 52;
const MIN_GRANULARITY = 10;
const MAX_GRANULARITY = 1000;
const MAX_DIRECT_PATTERN_GRID = 1000;
const MAX_PIXEL_ART_DETECTION_SIDE = 4096;
const LIVE_PREVIEW_DELAY = 320;
const EXPORT_MIN_LONG_SIDE = 8192;
const BEAD_SIZE_CM = 0.26;
const GALLERY_STORAGE_KEY = "libai-maker-generated-gallery";
const PROJECT_FILE_VERSION = 1;
const MAX_GALLERY_ITEMS = 18;
const A4_DPI = 300;
const A4_SIZE_MM = { width: 210, height: 297 };
const EDITOR_CELL_SIZE = 30;
const EDITOR_MARGIN = 42;
const DIRECT_PATTERN_COLOR_TOLERANCE = 38;
const DIRECT_PATTERN_MIN_COLOR_COUNT = 3;
const NSFWJS_SCRIPT_URL = "./assets/vendor/nsfwjs.min.js";
const NSFW_MODEL_URL = "./assets/vendor/nsfw-model/";
const JSPDF_SCRIPT_URL = "./assets/vendor/jspdf.umd.min.js";
const SAFETY_SCRIPT_LOAD_TIMEOUT = 8000;
const SAFETY_MODEL_LOAD_TIMEOUT = 12000;
const NSFW_THRESHOLDS = {
  Porn: 0.55,
  Hentai: 0.55,
  Sexy: 0.88,
};
const LOCAL_WATERMARK_TEXT = "本图纸由用户在浏览器本地生成，请合规使用";
const MARD_COLOR_SOURCE_URL = "https://www.pixel-beads.com/zh/mard-bead-color-chart";
const MARD_COLOR_SOURCE_VERSION = "MARD 2026";
const MARD_EXPECTED_COLOR_COUNT = 291;
const PALETTE_SIZE_OPTIONS = [48, 64, 72, 90, 144, 221, 264, 291];
const CANVAS_FONT_STACK =
  'DottedPixel, "Maple Mono", "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif';
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
const DEFAULT_PALETTE_SIZE = 291;
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
  return colors.slice(0, count).map((color, index) => ({
    code: getBrandCode(color, brand, profile, index),
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
  editorPaletteSelect: document.querySelector("#editor-palette-select"),
  uploadZone: document.querySelector("#upload-zone"),
  fileInput: document.querySelector("#file-input"),
  directPatternFileInput: document.querySelector("#direct-pattern-file-input"),
  projectFileInput: document.querySelector("#project-file-input"),
  sourcePreview: document.querySelector("#source-preview"),
  sourceTitle: document.querySelector("#source-title"),
  statusPill: document.querySelector("#status-pill"),
  importButton: document.querySelector("#import-button"),
  mobileImportButton: document.querySelector("#mobile-import-button"),
  mobileProjectImportButton: document.querySelector("#mobile-project-import-button"),
  mobileProjectExportButton: document.querySelector("#mobile-project-export-button"),
  mobileProcessButton: document.querySelector("#mobile-process-button"),
  mobileDownloadButton: document.querySelector("#mobile-download-button"),
  mobileStartAssemblyButton: document.querySelector("#mobile-start-assembly-button"),
  mobilePreviewDownloadButton: document.querySelector("#mobile-preview-download-button"),
  mobileChartDownloadButton: document.querySelector("#mobile-chart-download-button"),
  mobilePrintA4Button: document.querySelector("#mobile-print-a4-button"),
  fullscreenButton: document.querySelector("#fullscreen-button"),
  historyButton: document.querySelector("#history-button"),
  projectImportButton: document.querySelector("#project-import-button"),
  projectExportButton: document.querySelector("#project-export-button"),
  projectImportButtonSide: document.querySelector("#project-import-button-side"),
  projectExportButtonSide: document.querySelector("#project-export-button-side"),
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
  directPatternDetectButton: document.querySelector("#direct-pattern-detect-button"),
  assemblyModal: document.querySelector("#assembly-modal"),
  assemblyProgressLabel: document.querySelector("#assembly-progress-label"),
  assemblyBoardPicker: document.querySelector("#assembly-board-picker"),
  assemblyBoardLabel: document.querySelector("#assembly-board-label"),
  assemblyBoardRange: document.querySelector("#assembly-board-range"),
  assemblyBoardButtons: document.querySelector("#assembly-board-buttons"),
  assemblySummary: document.querySelector("#assembly-summary"),
  assemblyColorList: document.querySelector("#assembly-color-list"),
  assemblyBoard: document.querySelector("#pixel-board-container"),
  assemblyClearFocusButton: document.querySelector("#assembly-clear-focus-button"),
  assemblyResetProgressButton: document.querySelector("#assembly-reset-progress-button"),
  assemblyTimer: document.querySelector("#assembly-timer"),
  assemblyTimerToggle: document.querySelector("#assembly-timer-toggle"),
  assemblyModeButtons: document.querySelectorAll("[data-assembly-mode]"),
  assemblyPrevButton: document.querySelector("#assembly-prev-button"),
  assemblyNextButton: document.querySelector("#assembly-next-button"),
  assemblyNextIncompleteButton: document.querySelector("#assembly-next-incomplete-button"),
  assemblyUndoButton: document.querySelector("#assembly-undo-button"),
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
  gridHeightNumber: document.querySelector("#grid-height-number"),
  ratioLockButton: document.querySelector("#ratio-lock-button"),
  ratioHelp: document.querySelector("#ratio-help"),
  cropModeSelect: document.querySelector("#crop-mode-select"),
  cropZoomInput: document.querySelector("#crop-zoom-input"),
  cropZoomOutput: document.querySelector("#crop-zoom-output"),
  cropXInput: document.querySelector("#crop-x-input"),
  cropYInput: document.querySelector("#crop-y-input"),
  compositionResetButton: document.querySelector("#composition-reset-button"),
  mobileGranularityInput: document.querySelector("#mobile-granularity-input"),
  mobileGranularityOutput: document.querySelector("#mobile-granularity-output"),
  similarityInput: document.querySelector("#similarity-input"),
  similarityOutput: document.querySelector("#similarity-output"),
  similarityNumber: document.querySelector("#similarity-number"),
  similarityApply: document.querySelector("#similarity-apply"),
  colorLimitSelect: document.querySelector("#color-limit-select"),
  isolationInput: document.querySelector("#isolation-input"),
  isolationOutput: document.querySelector("#isolation-output"),
  smartPresetButton: document.querySelector("#smart-preset-button"),
  applyCleanupButton: document.querySelector("#apply-cleanup-button"),
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
  redoEditorButton: document.querySelector("#redo-editor-button"),
  applySelectionColorButton: document.querySelector("#apply-selection-color-button"),
  replaceFrom: document.querySelector("#replace-from"),
  replaceTo: document.querySelector("#replace-to"),
  replaceButton: document.querySelector("#replace-button"),
  undoReplaceButton: document.querySelector("#undo-replace-button"),
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
  rotateLeftButton: document.querySelector("#rotate-left-button"),
  rotateRightButton: document.querySelector("#rotate-right-button"),
  editorSymmetrySelect: document.querySelector("#editor-symmetry-select"),
  scaleDownButton: document.querySelector("#scale-down-button"),
  scaleUpButton: document.querySelector("#scale-up-button"),
  referenceImageInput: document.querySelector("#reference-image-input"),
  referenceImageButton: document.querySelector("#reference-image-button"),
  clearReferenceButton: document.querySelector("#clear-reference-button"),
  libraryImportSelect: document.querySelector("#library-import-select"),
  importLibraryButton: document.querySelector("#import-library-button"),
  trimArtworkButton: document.querySelector("#trim-artwork-button"),
  fitEditorButton: document.querySelector("#fit-editor-button"),
  clearArtworkButton: document.querySelector("#clear-artwork-button"),
  artworkNameInput: document.querySelector("#artwork-name-input"),
  assemblyModeButton: document.querySelector("#assembly-mode-button"),
  saveLibraryButton: document.querySelector("#save-library-button"),
  downloadEditorButton: document.querySelector("#download-editor-button"),
  cancelEditButton: document.querySelector("#cancel-edit-button"),
  saveEditButton: document.querySelector("#save-edit-button"),
  generatedGallery: document.querySelector("#generated-gallery"),
  gallerySearch: document.querySelector("#gallery-search"),
  galleryCount: document.querySelector("#gallery-count"),
  galleryEmpty: document.querySelector("#gallery-empty"),
  galleryClearButton: document.querySelector("#gallery-clear-button"),
};

const state = {
  sourceDataUrl: "",
  sourceName: "",
  grid: [],
  stats: [],
  chartUrl: "",
  previewUrl: "",
  paletteLabel: "",
  width: 0,
  height: 0,
  sourceAspectRatio: 1,
  ratioLocked: true,
  optimizationSummary: "",
  previewZoom: 1,
  editorZoom: 1,
  selectedBrand: DEFAULT_BRAND,
  selectedColor: null,
  editorGrid: [],
  editorTool: "pencil",
  editorFloating: null,
  editorSelection: null,
  editorSelectedCells: new Set(),
  editorLassoPoints: [],
  editorHistory: [],
  editorRedo: [],
  editorActionSnapshot: null,
  editorSymmetry: "none",
  editorReferenceImage: null,
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
  assemblyEngine: null,
  assemblyBoardRow: 0,
  assemblyBoardCol: 0,
  assemblyNavigationMode: "color",
  assemblyNavigationIndex: 0,
  assemblyUndo: [],
  assemblyElapsedMs: 0,
  assemblyTimerStartedAt: 0,
  assemblyTimerRunning: false,
  assemblyTimerInterval: 0,
  directPatternFile: null,
  paintUndo: [],
  replaceUndo: [],
  isPainting: false,
  lastPaintKey: "",
  importMode: "photo",
  autoProcessAfterLoad: false,
  restoreAutoSizePending: false,
  livePreviewTimer: 0,
  livePreviewPending: false,
  isProcessingImage: false,
  backgroundDecision: "",
  sourceSafetyChecked: false,
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
  validateMardPalette();
  preloadPixelFont();
  if (els.boardSelect) {
    BOARD_SIZES.forEach(([value, label]) => {
      els.boardSelect.append(new Option(label, value));
    });
    els.boardSelect.value = "custom";
  }
  syncRangeControls("granularity", DEFAULT_GRANULARITY, MIN_GRANULARITY, MAX_GRANULARITY);
  syncRangeControls("similarity", 30, 0, 100);
  syncIsolationControl();
  updateCompositionUi();
  updateRatioLockUi();
  updatePaletteOptions();
  updateEditorPaletteOptions();
  updatePaletteCount();
  updateVisitCount();
  renderGeneratedGallery();
  renderEditorLibraryOptions();
  bindEvents();
  updateResultUi();
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
  els.mobileProjectImportButton?.addEventListener("click", openProjectImport);
  els.mobileProjectExportButton?.addEventListener("click", exportLocalProject);
  els.mobileProcessButton?.addEventListener("click", processImage);
  els.mobileDownloadButton?.addEventListener("click", downloadPattern);
  els.mobileStartAssemblyButton?.addEventListener("click", openAssemblyPlayer);
  els.mobilePreviewDownloadButton?.addEventListener("click", downloadPreviewImage);
  els.mobileChartDownloadButton?.addEventListener("click", downloadPattern);
  els.mobilePrintA4Button?.addEventListener("click", downloadA4PrintPattern);
  els.fullscreenButton?.addEventListener("click", toggleFullscreen);
  els.historyButton?.addEventListener("click", scrollToHistory);
  els.projectImportButton?.addEventListener("click", openProjectImport);
  els.projectImportButtonSide?.addEventListener("click", openProjectImport);
  els.projectExportButton?.addEventListener("click", exportLocalProject);
  els.projectExportButtonSide?.addEventListener("click", exportLocalProject);
  els.projectFileInput?.addEventListener("change", importLocalProject);
  els.smartPhotoButton?.addEventListener("click", startPhotoImport);
  els.smartRestoreButton?.addEventListener("click", startRestoreImport);
  els.smartDirectButton?.addEventListener("click", startDirectPatternImport);
  els.smartOcrButton?.addEventListener("click", startOcrImport);
  els.smartLinkButton?.addEventListener("click", openLinkImportModal);
  els.tutorialButton?.addEventListener("click", showTutorialHint);
  els.linkImportForm?.addEventListener("submit", importImageFromLink);
  els.directPatternFileInput?.addEventListener("change", handleDirectPatternFileChange);
  els.directPatternForm?.addEventListener("submit", handleDirectPatternSubmit);
  els.directPatternDetectButton?.addEventListener("click", detectDirectPatternSize);
  els.gallerySearch?.addEventListener("input", renderGeneratedGallery);
  els.galleryClearButton?.addEventListener("click", clearGeneratedGallery);
  els.downloadButtonTop?.addEventListener("click", downloadPattern);
  els.blankBoardButton?.addEventListener("click", createBlankBoard);
  els.brandButtons.forEach((button) => {
    button.addEventListener("click", () => selectBrand(button.dataset.brand || DEFAULT_BRAND));
  });
  bindRangePair("granularity", MIN_GRANULARITY, MAX_GRANULARITY);
  els.mobileGranularityInput?.addEventListener("input", () => {
    syncRangeControls("granularity", els.mobileGranularityInput.value, MIN_GRANULARITY, MAX_GRANULARITY);
    scheduleLivePreview("宽度已更新");
  });
  els.gridHeightNumber?.addEventListener("input", handleGridHeightInput);
  els.gridHeightNumber?.addEventListener("change", handleGridHeightInput);
  els.ratioLockButton?.addEventListener("click", toggleRatioLock);
  bindRangePair("similarity", 0, 100);
  els.colorLimitSelect?.addEventListener("change", () => scheduleLivePreview("颜色聚类已更新"));
  els.isolationInput?.addEventListener("input", () => {
    syncIsolationControl();
    scheduleLivePreview("孤立色块阈值已更新");
  });
  document.addEventListener("click", handleSmartOptimizationClick);
  els.paletteSelect.addEventListener("change", () => {
    updatePaletteCount();
    updateEditorPaletteOptions();
    updateResultUi();
    scheduleLivePreview("色板已更新");
  });
  els.backgroundModeSelect?.addEventListener("change", () => {
    scheduleLivePreview("背景处理已更新");
  });
  [els.cropModeSelect, els.cropZoomInput, els.cropXInput, els.cropYInput].forEach((control) => {
    control?.addEventListener("input", () => {
      updateCompositionUi();
      scheduleLivePreview("构图已更新");
    });
  });
  els.compositionResetButton?.addEventListener("click", resetComposition);
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
      return;
    }
    state.autoProcessAfterLoad = false;
    state.restoreAutoSizePending = false;
  });

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
  els.uploadZone.addEventListener("click", () => {
    state.importMode = "photo";
    state.autoProcessAfterLoad = true;
    state.restoreAutoSizePending = false;
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
  els.downloadButton.addEventListener("click", downloadPattern);
  els.printA4Button?.addEventListener("click", downloadA4PrintPattern);
  els.editButton.addEventListener("click", openEditor);
  els.startAssemblyButton?.addEventListener("click", openAssemblyPlayer);
  els.startAssemblyPanelButton?.addEventListener("click", openAssemblyPlayer);
  els.assemblyBoard?.addEventListener("pointerdown", handleAssemblyBoardPointerDown);
  els.assemblyBoard?.addEventListener("pointermove", handleAssemblyBoardPointerMove);
  els.assemblyBoard?.addEventListener("pointerup", handleAssemblyBoardPointerUp);
  els.assemblyBoard?.addEventListener("pointercancel", handleAssemblyBoardPointerCancel);
  els.assemblyBoard?.addEventListener("pointerleave", handleAssemblyBoardPointerLeave);
  els.assemblyBoard?.addEventListener("wheel", handleAssemblyBoardWheel, { passive: false });
  els.assemblyClearFocusButton?.addEventListener("click", () => selectAssemblyColor(""));
  els.assemblyResetProgressButton?.addEventListener("click", resetAssemblyProgress);
  els.assemblyTimerToggle?.addEventListener("click", toggleAssemblyTimer);
  els.assemblyModeButtons.forEach((button) => {
    button.addEventListener("click", () => setAssemblyNavigationMode(button.dataset.assemblyMode || "color"));
  });
  els.assemblyPrevButton?.addEventListener("click", () => navigateAssembly(-1));
  els.assemblyNextButton?.addEventListener("click", () => navigateAssembly(1));
  els.assemblyNextIncompleteButton?.addEventListener("click", navigateToNextIncomplete);
  els.assemblyUndoButton?.addEventListener("click", undoAssemblyCompletion);
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
    els.donateQrcode.closest(".qrcode-container, .bmc-qr-wrapper")?.classList.add("has-qrcode");
  });
  els.donateQrcode?.addEventListener("error", () => {
    els.donateQrcode.closest(".qrcode-container, .bmc-qr-wrapper")?.classList.add("is-missing");
  });
  window.addEventListener("popstate", handleAssemblyPopState);
  window.addEventListener("keydown", handleEditorHistoryShortcut);

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
  els.undoPaintButton.addEventListener("click", undoEditor);
  els.redoEditorButton?.addEventListener("click", redoEditor);
  els.applySelectionColorButton?.addEventListener("click", applyColorToEditorSelection);
  els.replaceFrom.addEventListener("change", updateEditorControls);
  els.replaceTo.addEventListener("change", updateEditorControls);
  els.replaceButton.addEventListener("click", replaceColor);
  els.undoReplaceButton.addEventListener("click", undoEditor);
  els.applyFloatingButton?.addEventListener("click", applyFloatingPattern);
  els.cancelFloatingButton?.addEventListener("click", cancelFloatingPattern);
  els.toggleEditorGrid?.addEventListener("change", updateEditorPrefsFromControls);
  els.toggleEditorCodes?.addEventListener("change", updateEditorPrefsFromControls);
  els.toggleEditorCoords?.addEventListener("change", updateEditorPrefsFromControls);
  els.toggleEditorSnap?.addEventListener("change", updateEditorPrefsFromControls);
  els.editorToolbarPosition?.addEventListener("change", updateEditorPrefsFromControls);
  els.flipHorizontalButton?.addEventListener("click", () => transformEditorGrid("flip-horizontal"));
  els.flipVerticalButton?.addEventListener("click", () => transformEditorGrid("flip-vertical"));
  els.rotateLeftButton?.addEventListener("click", () => transformEditorGrid("rotate-left"));
  els.rotateRightButton?.addEventListener("click", () => transformEditorGrid("rotate-right"));
  els.editorSymmetrySelect?.addEventListener("change", () => {
    state.editorSymmetry = els.editorSymmetrySelect.value || "none";
  });
  els.scaleDownButton?.addEventListener("click", () => transformEditorGrid("scale-down"));
  els.scaleUpButton?.addEventListener("click", () => transformEditorGrid("scale-up"));
  els.referenceImageButton?.addEventListener("click", () => els.referenceImageInput?.click());
  els.clearReferenceButton?.addEventListener("click", clearEditorReferenceImage);
  els.referenceImageInput?.addEventListener("change", loadEditorReferenceImage);
  els.libraryImportSelect?.addEventListener("change", updateLibraryImportButton);
  els.importLibraryButton?.addEventListener("click", importSelectedLibraryItem);
  els.trimArtworkButton?.addEventListener("click", trimEditorArtwork);
  els.fitEditorButton?.addEventListener("click", fitEditorToScreen);
  els.clearArtworkButton?.addEventListener("click", clearEditorArtwork);
  els.assemblyModeButton?.addEventListener("click", startAssemblyMode);
  els.saveLibraryButton?.addEventListener("click", saveEditorToLibrary);
  els.downloadEditorButton?.addEventListener("click", downloadEditorArtwork);
  els.cancelEditButton.addEventListener("click", () => els.editorModal.close());
  els.saveEditButton.addEventListener("click", saveEditor);

  els.editorCanvas.addEventListener("pointerdown", (event) => {
    state.isPainting = true;
    state.lastPaintKey = "";
    beginEditorPointerAction();
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
    els.linkImportModal,
    els.directPatternModal,
    els.assemblyModal,
    els.editorModal,
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
  if (name === "granularity") number.addEventListener("input", commit);
  number.addEventListener("change", commit);
  apply?.addEventListener("click", commit);
}

function handleEditorHistoryShortcut(event) {
  if (!els.editorModal?.open || (!event.metaKey && !event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    undoEditor();
  } else if (key === "y" || (key === "z" && event.shiftKey)) {
    event.preventDefault();
    redoEditor();
  }
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
    if (state.ratioLocked) syncDimensionHeightFromWidth(next);
  }
  return next;
}

function getGranularity() {
  return syncRangeControls(
    "granularity",
    els.granularityInput?.value || DEFAULT_GRANULARITY,
    MIN_GRANULARITY,
    MAX_GRANULARITY,
  );
}

function getGridHeight() {
  if (state.ratioLocked) {
    return syncDimensionHeightFromWidth(getGranularity());
  }
  const next = Math.round(
    clamp(Number(els.gridHeightNumber?.value) || DEFAULT_GRANULARITY, MIN_GRANULARITY, MAX_GRANULARITY),
  );
  if (els.gridHeightNumber) els.gridHeightNumber.value = String(next);
  return next;
}

function syncDimensionHeightFromWidth(width) {
  const ratio = Math.max(0.001, Number(state.sourceAspectRatio) || 1);
  const next = Math.round(clamp(width / ratio, MIN_GRANULARITY, MAX_GRANULARITY));
  if (els.gridHeightNumber) els.gridHeightNumber.value = String(next);
  updateRatioLockUi();
  return next;
}

function handleGridHeightInput() {
  const requested = Number(els.gridHeightNumber?.value || 0);
  if (!Number.isFinite(requested) || requested < MIN_GRANULARITY) return;
  const height = Math.round(clamp(requested, MIN_GRANULARITY, MAX_GRANULARITY));
  if (els.gridHeightNumber) els.gridHeightNumber.value = String(height);
  if (state.ratioLocked) {
    const width = Math.round(height * Math.max(0.001, Number(state.sourceAspectRatio) || 1));
    syncRangeControls("granularity", width, MIN_GRANULARITY, MAX_GRANULARITY);
  } else {
    updateRatioLockUi();
  }
  scheduleLivePreview("高度已更新");
}

function toggleRatioLock() {
  state.ratioLocked = !state.ratioLocked;
  if (state.ratioLocked) syncDimensionHeightFromWidth(getGranularity());
  updateRatioLockUi();
  scheduleLivePreview(state.ratioLocked ? "已锁定原图比例" : "已解锁比例");
}

function updateRatioLockUi() {
  const ratio = Math.max(0.001, Number(state.sourceAspectRatio) || 1);
  const width = Number(els.granularityNumber?.value || DEFAULT_GRANULARITY);
  const height = Number(els.gridHeightNumber?.value || DEFAULT_GRANULARITY);
  if (els.ratioLockButton) {
    els.ratioLockButton.classList.toggle("is-locked", state.ratioLocked);
    els.ratioLockButton.setAttribute("aria-pressed", String(state.ratioLocked));
    els.ratioLockButton.setAttribute("aria-label", state.ratioLocked ? "解锁长宽比例" : "锁定长宽比例");
    const icon = els.ratioLockButton.querySelector(".lock-icon");
    if (icon) icon.textContent = state.ratioLocked ? "🔗" : "🔓";
  }
  if (els.ratioHelp) {
    const ratioLabel = ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
    els.ratioHelp.textContent = state.ratioLocked
      ? `已锁定原图比例 ${ratioLabel}，当前 ${width} × ${height} 格。`
      : `比例已解锁，当前将强制输出 ${width} × ${height} 格。`;
  }
}

function captureSourceAspectRatio(image) {
  const width = Number(image?.naturalWidth || image?.width || 1);
  const height = Number(image?.naturalHeight || image?.height || 1);
  state.sourceAspectRatio = width > 0 && height > 0 ? width / height : 1;
  if (state.ratioLocked) syncDimensionHeightFromWidth(getGranularity());
  updateRatioLockUi();
}

function updateCompositionUi() {
  if (els.cropZoomOutput) {
    els.cropZoomOutput.textContent = `${Math.round(Number(els.cropZoomInput?.value || 100))}%`;
  }
  const movable = (els.cropModeSelect?.value || "cover") !== "stretch";
  if (els.cropZoomInput) els.cropZoomInput.disabled = !movable;
  if (els.cropXInput) els.cropXInput.disabled = !movable;
  if (els.cropYInput) els.cropYInput.disabled = !movable;
}

function resetComposition() {
  if (els.cropModeSelect) els.cropModeSelect.value = "cover";
  if (els.cropZoomInput) els.cropZoomInput.value = "100";
  if (els.cropXInput) els.cropXInput.value = "0";
  if (els.cropYInput) els.cropYInput.value = "0";
  updateCompositionUi();
  scheduleLivePreview("构图已重置");
}

function drawImageWithComposition(context, image, width, height) {
  const mode = els.cropModeSelect?.value || "cover";
  if (mode === "stretch") {
    context.drawImage(image, 0, 0, width, height);
    return;
  }
  const sourceWidth = Number(image.naturalWidth || image.width || width);
  const sourceHeight = Number(image.naturalHeight || image.height || height);
  const zoom = clamp(Number(els.cropZoomInput?.value || 100) / 100, 1, 3);
  const offsetX = clamp(Number(els.cropXInput?.value || 0) / 100, -1, 1);
  const offsetY = clamp(Number(els.cropYInput?.value || 0) / 100, -1, 1);

  if (mode === "contain") {
    const scale = Math.min(width / sourceWidth, height / sourceHeight) * zoom;
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const travelX = Math.max(0, width - drawWidth) / 2;
    const travelY = Math.max(0, height - drawHeight) / 2;
    context.drawImage(
      image,
      (width - drawWidth) / 2 + travelX * offsetX,
      (height - drawHeight) / 2 + travelY * offsetY,
      drawWidth,
      drawHeight,
    );
    return;
  }

  const targetRatio = width / height;
  const sourceRatio = sourceWidth / sourceHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  if (sourceRatio > targetRatio) cropWidth = sourceHeight * targetRatio;
  else cropHeight = sourceWidth / targetRatio;
  cropWidth /= zoom;
  cropHeight /= zoom;
  const maxX = Math.max(0, sourceWidth - cropWidth);
  const maxY = Math.max(0, sourceHeight - cropHeight);
  const sourceX = maxX * (offsetX + 1) / 2;
  const sourceY = maxY * (offsetY + 1) / 2;
  context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, width, height);
}

function syncIsolationControl(value = els.isolationInput?.value || 1) {
  const next = Math.round(clamp(Number(value) || 1, 1, 10));
  if (els.isolationInput) els.isolationInput.value = String(next);
  if (els.isolationOutput) els.isolationOutput.textContent = next <= 1 ? "关闭" : `< ${next} 格`;
  return next;
}

function getOptimizationOptions() {
  return {
    colorLimit: Math.max(0, Number(els.colorLimitSelect?.value || 0)),
    isolationThreshold: syncIsolationControl(),
  };
}

function handleSmartOptimizationClick(event) {
  if (event.target.closest("#smart-preset-button")) {
    applySmartPreset();
    return;
  }
  if (event.target.closest("#apply-cleanup-button")) {
    applyOptimizationToCurrentGrid();
  }
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
  els.paletteSelect.value = String(profile.options.includes(current) ? current : DEFAULT_PALETTE_SIZE);
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
  els.brandButtons.forEach((button) => {
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

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
    return;
  }
  document.exitFullscreen?.();
}

function openProjectImport() {
  if (!els.projectFileInput) return;
  els.projectFileInput.value = "";
  els.projectFileInput.click();
}

function exportLocalProject() {
  if (!state.grid.length) return;
  const project = {
    type: "libai-maker-project",
    version: PROJECT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    name: getSchemeName() || buildGalleryTitle(),
    sourceName: state.sourceName,
    sourceDataUrl: state.sourceDataUrl || "",
    gridData: serializeGridForLibrary(state.grid),
    paletteKey: getActivePaletteKeyForStorage(),
    width: state.width,
    height: state.height,
    settings: {
      brand: state.selectedBrand,
      paletteSize: getSelectedPaletteSize(),
      similarity: getSimilarityThreshold(),
      colorLimit: Number(els.colorLimitSelect?.value || 0),
      isolation: syncIsolationControl(),
      tileSize: els.tileSizeSelect?.value || "smart",
      mirror: els.mirrorSelect?.value || "normal",
      cropMode: els.cropModeSelect?.value || "cover",
      cropZoom: Number(els.cropZoomInput?.value || 100),
      cropX: Number(els.cropXInput?.value || 0),
      cropY: Number(els.cropYInput?.value || 0),
    },
  };
  const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
  const base = sanitizeFileName(project.name || "libai-project");
  downloadBlob(blob, `${base}.libai.json`);
  setStatus("已导出本地项目");
}

async function importLocalProject(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    window.clearTimeout(state.livePreviewTimer);
    state.livePreviewTimer = 0;
    const project = JSON.parse(await file.text());
    if (project?.type !== "libai-maker-project" || !project.gridData) {
      throw new Error("不是有效的时里白造物项目文件");
    }
    const grid = deserializeGridFromLibrary(project);
    if (!grid?.length || !grid[0]?.length) throw new Error("项目网格为空");
    const settings = project.settings || {};
    if (BRAND_PROFILES[settings.brand]) selectBrand(settings.brand);
    window.clearTimeout(state.livePreviewTimer);
    state.livePreviewTimer = 0;
    if (els.paletteSelect && settings.paletteSize) {
      els.paletteSelect.value = String(settings.paletteSize);
      updateEditorPaletteOptions();
    }
    state.grid = cloneGrid(grid);
    state.width = grid[0].length;
    state.height = grid.length;
    state.sourceName = project.sourceName || project.name || file.name;
    state.sourceDataUrl = typeof project.sourceDataUrl === "string" ? project.sourceDataUrl : "";
    state.sourceSafetyChecked = true;
    state.paletteLabel = getPaletteLabelForKey(project.paletteKey);
    state.stats = calculateStats(state.grid);
    state.optimizationSummary = "";
    state.ratioLocked = false;
    syncRangeControls("granularity", state.width, MIN_GRANULARITY, MAX_GRANULARITY);
    if (els.gridHeightNumber) els.gridHeightNumber.value = String(state.height);
    syncRangeControls("similarity", settings.similarity ?? 30, 0, 100);
    if (els.colorLimitSelect) els.colorLimitSelect.value = String(settings.colorLimit || 0);
    syncIsolationControl(settings.isolation || 1);
    if (els.tileSizeSelect) els.tileSizeSelect.value = settings.tileSize || "smart";
    if (els.mirrorSelect) els.mirrorSelect.value = settings.mirror || "normal";
    if (els.cropModeSelect) els.cropModeSelect.value = settings.cropMode || "cover";
    if (els.cropZoomInput) els.cropZoomInput.value = String(settings.cropZoom || 100);
    if (els.cropXInput) els.cropXInput.value = String(settings.cropX || 0);
    if (els.cropYInput) els.cropYInput.value = String(settings.cropY || 0);
    if (els.schemeNameInput) els.schemeNameInput.value = project.name || "时里白造物图纸";
    updateCompositionUi();
    updateRatioLockUi();
    refreshChartUrl();
    updateResultUi();
    saveCurrentToGallery();
    setStatus("已导入本地项目");
  } catch (error) {
    console.error(error);
    setStatus("项目导入失败");
    window.alert(error.message || "项目文件无法读取");
  }
}

function scrollToHistory() {
  document.querySelector(".gallery-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startManualImport() {
  state.importMode = "photo";
  state.autoProcessAfterLoad = false;
  state.restoreAutoSizePending = false;
  state.backgroundDecision = "";
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

async function handleDirectPatternFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!isImageFile(file)) {
    setStatus("请用 PNG/JPG");
    return;
  }
  state.directPatternFile = file;
  const defaultWidth = Number(els.granularityInput?.value || DEFAULT_GRANULARITY);
  if (els.directPatternWidth) els.directPatternWidth.value = String(clamp(defaultWidth, 1, MAX_DIRECT_PATTERN_GRID));
  if (els.directPatternHeight) els.directPatternHeight.value = String(clamp(defaultWidth, 1, MAX_DIRECT_PATTERN_GRID));
  if (els.directPatternMessage) {
    els.directPatternMessage.textContent = `已选择：${file.name}。请填写图纸实际格数。`;
  }
  els.directPatternModal?.showModal();
  await detectDirectPatternSize();
  els.directPatternWidth?.focus();
}

async function detectDirectPatternSize() {
  if (!state.directPatternFile) return;
  try {
    const image = await loadImage(await readFileAsDataUrl(state.directPatternFile));
    const detectedWidth =
      detectPixelArtLogicalWidth(image) ||
      (image.naturalWidth <= MAX_DIRECT_PATTERN_GRID ? image.naturalWidth : null);
    if (!detectedWidth) throw new Error("未检测到稳定像素格");
    const detectedHeight = Math.round(detectedWidth * image.naturalHeight / image.naturalWidth);
    if (els.directPatternWidth) els.directPatternWidth.value = String(clamp(detectedWidth, 1, MAX_DIRECT_PATTERN_GRID));
    if (els.directPatternHeight) {
      els.directPatternHeight.value = String(clamp(detectedHeight, 1, MAX_DIRECT_PATTERN_GRID));
    }
    if (els.directPatternMessage) {
      els.directPatternMessage.textContent = `已自动检测：${detectedWidth} × ${detectedHeight} 格。请确认后开始扫描。`;
    }
  } catch (error) {
    console.warn("Direct pattern auto detection unavailable", error);
    if (els.directPatternMessage) {
      els.directPatternMessage.textContent = "未能自动检测稳定格数，请手动输入后开始扫描。";
    }
  }
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
  if (
    gridWidth < 1 ||
    gridHeight < 1 ||
    gridWidth > MAX_DIRECT_PATTERN_GRID ||
    gridHeight > MAX_DIRECT_PATTERN_GRID
  ) {
    if (els.directPatternMessage) {
      els.directPatternMessage.textContent = `格数需要在 1 到 ${MAX_DIRECT_PATTERN_GRID} 之间。`;
    }
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
    state.sourceName = file.name;
    state.sourceSafetyChecked = true;
    captureSourceAspectRatio(await loadImage(prepared.dataUrl));
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
      if (!window.nsfwjs) await loadScriptOnce(NSFWJS_SCRIPT_URL);
      if (!window.nsfwjs?.load) return null;
      state.safetyModel = await withTimeout(window.nsfwjs.load(NSFW_MODEL_URL), SAFETY_MODEL_LOAD_TIMEOUT);
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

async function processImage(options = {}) {
  if (!state.sourceDataUrl) {
    setStatus("请先上传");
    return false;
  }
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
    const image = await loadImage(state.sourceDataUrl);
    applyRestoreSizing(image);
    const palette = getCurrentPalette();
    const result = rasterizeImage(image, palette);
    const optimized = optimizeGrid(result.grid, getOptimizationOptions());
    state.grid = optimized.grid;
    state.width = result.width;
    state.height = result.height;
    state.backgroundDecision = result.backgroundDecision || "";
    state.optimizationSummary = optimized.summary;
    state.paletteLabel = getCurrentPaletteLabel();
    state.stats = calculateStats(state.grid);
    state.assemblyHideCellText = false;
    refreshChartUrl();
    updateResultUi();
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
    syncRangeControls("granularity", detectedWidth, MIN_GRANULARITY, MAX_GRANULARITY);
    return;
  }
  if (naturalWidth <= MAX_GRANULARITY) {
    syncRangeControls("granularity", naturalWidth, MIN_GRANULARITY, MAX_GRANULARITY);
  }
}

function detectPixelArtLogicalWidth(image) {
  const width = Number(image.naturalWidth || 0);
  const height = Number(image.naturalHeight || 0);
  if (
    width < 48 ||
    height < 48 ||
    width > MAX_PIXEL_ART_DETECTION_SIDE ||
    height > MAX_PIXEL_ART_DETECTION_SIDE
  ) {
    return null;
  }

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
  if (logicalWidth < MIN_GRANULARITY || logicalWidth > MAX_GRANULARITY) return null;
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
      const pixel = sampleDirectPatternCell(context, colIndex, rowIndex, cellPixelWidth, cellPixelHeight, canvas);
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
  state.optimizationSummary = "";
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

function sampleDirectPatternCell(context, column, row, cellWidth, cellHeight, canvas) {
  const samples = [];
  for (const offsetY of [0.38, 0.5, 0.62]) {
    for (const offsetX of [0.38, 0.5, 0.62]) {
      const x = clamp(Math.floor((column + offsetX) * cellWidth), 0, canvas.width - 1);
      const y = clamp(Math.floor((row + offsetY) * cellHeight), 0, canvas.height - 1);
      const pixel = context.getImageData(x, y, 1, 1).data;
      if (pixel[3] >= 24) samples.push([pixel[0], pixel[1], pixel[2], pixel[3]]);
    }
  }
  if (!samples.length) return [255, 255, 255, 0];
  samples.sort((a, b) => getBrightness(a) - getBrightness(b));
  return samples[Math.floor(samples.length / 2)];
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

function rasterizeImage(image, palette) {
  const width = getGranularity();
  const height = getGridHeight();
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
  drawImageWithComposition(context, image, width, height);

  const pixels = context.getImageData(0, 0, width, height).data;
  const background = getBackgroundMask(pixels, width, height);
  const backgroundMask = background.mask;
  const grid = Array.from({ length: height }, () => Array(width).fill(null));
  if (mode === "dither") {
    return {
      width,
      height,
      grid: ditherPixels(pixels, width, height, palette, threshold, backgroundMask),
      backgroundDecision: background.decision,
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
      grid[y][x] = cloneColor(nearestColor(red, green, blue, palette));
    }
  }

  return { width, height, grid, backgroundDecision: background.decision };
}

function getGeneratedStatus() {
  const details = [];
  if (state.backgroundDecision === "auto-removed") details.push("已智能去背景");
  if (state.backgroundDecision === "auto-kept") details.push("已保留完整背景");
  if (state.backgroundDecision === "force-removed") details.push("已强制去背景");
  if (state.optimizationSummary) details.push(state.optimizationSummary);
  return ["已生成", ...details].join(" · ");
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
      const color = nearestColor(red, green, blue, palette);
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

function nearestColor(red, green, blue, palette) {
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

function optimizeGrid(grid, options = {}) {
  const colorLimit = Math.max(0, Number(options.colorLimit || 0));
  const isolationThreshold = Math.max(1, Number(options.isolationThreshold || 1));
  if (!grid.length || (colorLimit <= 0 && isolationThreshold <= 1)) {
    return { grid, summary: "", changedCount: 0 };
  }

  const beforeColors = calculateStats(grid).length;
  let output = grid;
  let changedCount = 0;
  let clusterApplied = false;

  if (colorLimit > 0 && beforeColors > colorLimit) {
    const limited = limitGridColorsWithWeightedKMeans(output, colorLimit);
    output = limited.grid;
    changedCount += limited.changedCount;
    clusterApplied = true;
  }

  const filtered = applyMajorityColorFilter(output);
  output = filtered.grid;
  changedCount += filtered.changedCount;

  if (isolationThreshold > 1) {
    const cleaned = removeIsolatedColorComponents(output, isolationThreshold);
    output = cleaned.grid;
    changedCount += cleaned.changedCount;
  }

  const afterColors = calculateStats(output).length;
  const summaryParts = [];
  if (beforeColors !== afterColors) {
    summaryParts.push(`${clusterApplied ? "聚类" : "降噪"} ${beforeColors}→${afterColors} 色`);
  }
  if (changedCount > 0) summaryParts.push(`优化 ${formatCount(changedCount)} 格`);
  return {
    grid: output,
    summary: summaryParts.join(" · "),
    changedCount,
  };
}

function limitGridColorsWithWeightedKMeans(grid, maxColors) {
  const stats = calculateStats(grid);
  if (stats.length <= maxColors) return { grid, changedCount: 0 };
  const representatives = getWeightedKMeansRepresentatives(stats, maxColors);
  const replacements = new Map();
  for (const color of stats) {
    replacements.set(color.code, nearestColor(color.rgb[0], color.rgb[1], color.rgb[2], representatives));
  }

  let changedCount = 0;
  const output = grid.map((row) =>
    row.map((color) => {
      if (!color) return null;
      const replacement = replacements.get(color.code) || color;
      if (replacement.code !== color.code) changedCount += 1;
      return cloneColor(replacement);
    }),
  );
  return { grid: output, changedCount };
}

function getWeightedKMeansRepresentatives(stats, maxColors) {
  const samples = stats.map((color) => ({
    color,
    rgb: [...color.rgb],
    weight: Math.max(1, color.count || 1),
  }));
  const centroids = [[...samples[0].rgb]];

  while (centroids.length < Math.min(maxColors, samples.length)) {
    let bestSample = null;
    let bestScore = -1;
    for (const sample of samples) {
      const minDistance = Math.min(...centroids.map((centroid) => squaredRgbDistance(sample.rgb, centroid)));
      const score = minDistance * Math.log2(sample.weight + 1);
      if (score > bestScore) {
        bestScore = score;
        bestSample = sample;
      }
    }
    if (!bestSample || bestScore <= 0) break;
    centroids.push([...bestSample.rgb]);
  }

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (const sample of samples) {
      const clusterIndex = getNearestCentroidIndex(sample.rgb, centroids);
      const sum = sums[clusterIndex];
      sum[0] += sample.rgb[0] * sample.weight;
      sum[1] += sample.rgb[1] * sample.weight;
      sum[2] += sample.rgb[2] * sample.weight;
      sum[3] += sample.weight;
    }
    for (let index = 0; index < centroids.length; index += 1) {
      const sum = sums[index];
      if (!sum[3]) continue;
      centroids[index] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
    }
  }

  const representatives = [];
  const usedCodes = new Set();
  for (const centroid of centroids) {
    const nearest = samples
      .map((sample) => ({ sample, distance: squaredRgbDistance(sample.rgb, centroid) }))
      .sort((a, b) => a.distance - b.distance || b.sample.weight - a.sample.weight)[0]?.sample.color;
    if (nearest && !usedCodes.has(nearest.code)) {
      usedCodes.add(nearest.code);
      representatives.push(nearest);
    }
  }
  for (const color of stats) {
    if (representatives.length >= maxColors) break;
    if (usedCodes.has(color.code)) continue;
    usedCodes.add(color.code);
    representatives.push(color);
  }
  return representatives;
}

function getNearestCentroidIndex(rgbValue, centroids) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < centroids.length; index += 1) {
    const distance = squaredRgbDistance(rgbValue, centroids[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function squaredRgbDistance(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function applyMajorityColorFilter(grid) {
  const rows = grid.length;
  const columns = grid[0]?.length || 0;
  if (!rows || !columns) return { grid, changedCount: 0 };
  const colorsByCode = new Map(calculateStats(grid).map((color) => [color.code, color]));
  const output = cloneGrid(grid);
  let changedCount = 0;

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const current = grid[y][x];
      if (!current) continue;
      const counts = new Map();
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const neighbor = grid[y + dy]?.[x + dx];
          if (!neighbor) continue;
          counts.set(neighbor.code, (counts.get(neighbor.code) || 0) + 1);
        }
      }
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const [winnerCode, winnerCount] = ranked[0] || [];
      const currentCount = counts.get(current.code) || 0;
      if (!winnerCode || winnerCode === current.code || winnerCount < 4 || winnerCount <= currentCount + 1) continue;
      output[y][x] = cloneColor(colorsByCode.get(winnerCode));
      changedCount += 1;
    }
  }
  return { grid: output, changedCount };
}

function removeIsolatedColorComponents(grid, minSize) {
  const rows = grid.length;
  const columns = grid[0]?.length || 0;
  if (!rows || !columns || minSize <= 1) return { grid, changedCount: 0 };
  const totalPixels = rows * columns;
  const output = cloneGrid(grid);
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let changedCount = 0;

  for (let startIndex = 0; startIndex < totalPixels; startIndex += 1) {
    if (visited[startIndex] !== 0) continue;
    const startY = Math.floor(startIndex / columns);
    const startColor = grid[startY][startIndex % columns];
    if (!startColor) continue;

    const targetCode = startColor.code;
    let head = 0;
    let tail = 0;
    visited[startIndex] = 1;
    queue[tail++] = startIndex;

    /*
     * 使用 head 指针模拟队列出队，并直接内联四邻域检查。
     * 禁止使用 shift()、方向数组和回调，降低滑块高频调用时的 GC 与函数调用开销。
     */
    while (head < tail) {
      const currentIndex = queue[head++];
      const x = currentIndex % columns;
      const y = Math.floor(currentIndex / columns);

      // 1. 上方邻居
      if (currentIndex >= columns) {
        const nIdx = currentIndex - columns;
        const neighbor = grid[y - 1][x];
        if (visited[nIdx] === 0 && neighbor && neighbor.code === targetCode) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }

      // 2. 下方邻居
      if (currentIndex < totalPixels - columns) {
        const nIdx = currentIndex + columns;
        const neighbor = grid[y + 1][x];
        if (visited[nIdx] === 0 && neighbor && neighbor.code === targetCode) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }

      // 3. 左侧邻居
      if (x > 0) {
        const nIdx = currentIndex - 1;
        const neighbor = grid[y][x - 1];
        if (visited[nIdx] === 0 && neighbor && neighbor.code === targetCode) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }

      // 4. 右侧邻居
      if (x < columns - 1) {
        const nIdx = currentIndex + 1;
        const neighbor = grid[y][x + 1];
        if (visited[nIdx] === 0 && neighbor && neighbor.code === targetCode) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
    }

    if (tail >= minSize) continue;

    const neighborCounts = new Map();
    let replacement = null;
    let replacementCount = 0;

    for (let componentIndex = 0; componentIndex < tail; componentIndex += 1) {
      const currentIndex = queue[componentIndex];
      const x = currentIndex % columns;
      const y = Math.floor(currentIndex / columns);

      // 上方外围颜色
      if (currentIndex >= columns) {
        const neighbor = grid[y - 1][x];
        if (neighbor && neighbor.code !== targetCode) {
          const nextCount = (neighborCounts.get(neighbor.code) || 0) + 1;
          neighborCounts.set(neighbor.code, nextCount);
          if (
            nextCount > replacementCount ||
            (nextCount === replacementCount && replacement && neighbor.code.localeCompare(replacement.code) < 0)
          ) {
            replacement = neighbor;
            replacementCount = nextCount;
          }
        }
      }

      // 下方外围颜色
      if (currentIndex < totalPixels - columns) {
        const neighbor = grid[y + 1][x];
        if (neighbor && neighbor.code !== targetCode) {
          const nextCount = (neighborCounts.get(neighbor.code) || 0) + 1;
          neighborCounts.set(neighbor.code, nextCount);
          if (
            nextCount > replacementCount ||
            (nextCount === replacementCount && replacement && neighbor.code.localeCompare(replacement.code) < 0)
          ) {
            replacement = neighbor;
            replacementCount = nextCount;
          }
        }
      }

      // 左侧外围颜色
      if (x > 0) {
        const neighbor = grid[y][x - 1];
        if (neighbor && neighbor.code !== targetCode) {
          const nextCount = (neighborCounts.get(neighbor.code) || 0) + 1;
          neighborCounts.set(neighbor.code, nextCount);
          if (
            nextCount > replacementCount ||
            (nextCount === replacementCount && replacement && neighbor.code.localeCompare(replacement.code) < 0)
          ) {
            replacement = neighbor;
            replacementCount = nextCount;
          }
        }
      }

      // 右侧外围颜色
      if (x < columns - 1) {
        const neighbor = grid[y][x + 1];
        if (neighbor && neighbor.code !== targetCode) {
          const nextCount = (neighborCounts.get(neighbor.code) || 0) + 1;
          neighborCounts.set(neighbor.code, nextCount);
          if (
            nextCount > replacementCount ||
            (nextCount === replacementCount && replacement && neighbor.code.localeCompare(replacement.code) < 0)
          ) {
            replacement = neighbor;
            replacementCount = nextCount;
          }
        }
      }
    }

    if (!replacement) continue;
    for (let componentIndex = 0; componentIndex < tail; componentIndex += 1) {
      const index = queue[componentIndex];
      output[Math.floor(index / columns)][index % columns] = cloneColor(replacement);
      changedCount += 1;
    }
  }
  return { grid: output, changedCount };
}

function applySmartPreset() {
  if (els.colorLimitSelect) els.colorLimitSelect.value = "24";
  syncIsolationControl(3);
  if (els.modeSelect) els.modeSelect.value = "smooth";
  syncRangeControls("similarity", 36, 0, 100);
  if (state.sourceDataUrl) {
    processImage();
    return;
  }
  if (state.grid.length) {
    applyOptimizationToCurrentGrid();
    return;
  }
  setStatus("已设为推荐参数，请上传图片");
}

function applyOptimizationToCurrentGrid() {
  if (!state.grid.length) {
    setStatus("请先生成图纸");
    return;
  }
  const optimized = optimizeGrid(state.grid, getOptimizationOptions());
  state.grid = optimized.grid;
  state.optimizationSummary = optimized.summary || "当前图纸无需进一步优化";
  state.stats = calculateStats(state.grid);
  refreshChartUrl();
  updateResultUi();
  saveCurrentToGallery();
  setStatus(state.optimizationSummary);
}

function refreshChartUrl() {
  const maxSide = Math.max(state.width, state.height);
  const cell = maxSide > 260 ? 6 : maxSide > 160 ? 10 : maxSide > 90 ? 18 : 30;
  try {
    const previewCanvas = createChartCanvas(state.grid, state.stats, {
      cell,
      margin: 50,
      showLegend: false,
    });
    const canvas = createChartCanvas(state.grid, state.stats, {
      cell,
      margin: 50,
    });
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

function createChartCanvas(grid, stats, options = {}) {
  const rows = grid.length;
  const columns = grid[0]?.length || 0;
  const cell = options.cell || 30;
  const margin = options.margin || 54;
  const headerHeight = options.headerHeight || (options.subtitle ? 196 : 166);
  const showCodes = options.showCodes ?? cell >= 22;
  const title = options.title || "时里白造物拼豆图纸生成器";
  const paletteLabel = options.paletteLabel || getChartPaletteLabel();
  const totalBeads = stats.reduce((sum, item) => sum + item.count, 0);
  const finishedSize = formatFinishedSize(columns, rows);
  const boardX = margin;
  const boardY = headerHeight;
  const boardWidth = columns * cell;
  const boardHeight = rows * cell;
  const width = Math.max(960, boardWidth + margin * 2);
  const showLegend = options.showLegend ?? true;
  const legendLayout = showLegend ? getLegendLayout(width, stats.length, margin) : null;
  const legendTop = boardY + boardHeight + 54;
  const height = showLegend
    ? legendTop + legendLayout.rows * legendLayout.itemHeight + 58
    : boardY + boardHeight + 46;
  const outputScale = getCanvasOutputScale(width, height, options.minLongSide);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas context unavailable");
  canvas.width = Math.ceil(width * outputScale);
  canvas.height = Math.ceil(height * outputScale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.scale(outputScale, outputScale);

  context.fillStyle = "#fffdf7";
  context.fillRect(0, 0, width, height);
  drawChartHeader(context, {
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

  for (let x = 0; x < columns; x += 1) {
    const label = x + 1;
    if (!shouldShowCoordinateLabel(label, 1, columns, labelStep)) continue;
    const cx = boardX + x * cell + cell / 2;
    context.fillStyle = "#69716e";
    context.fillText(label, cx, boardY - 15);
    context.fillText(label, cx, boardY + boardHeight + 18);
  }

  for (let y = 0; y < rows; y += 1) {
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
        drawEmptyCell(context, px, py, cell);
      }
    }
  }
  drawCountingGrid(context, boardX, boardY, columns, rows, cell);

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
  context.fillText("时里白造物拼豆图纸", marginPx + 118, marginPx + 43);
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
  context.fillText("时里白造物拼豆图纸", textX, 50, textMaxWidth);
  context.fillStyle = "#4b5563";
  context.font = `800 14px ${CANVAS_FONT_STACK}`;
  context.fillText("时里白造物", textX, 73, textMaxWidth);

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
  context.fillText("时里白造物", details.width - details.margin, 42);

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
  context.fillText("时里白造物", 0, 0);
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

function formatCount(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
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
  if (els.startAssemblyButton) els.startAssemblyButton.disabled = !hasResult;
  if (els.startAssemblyPanelButton) els.startAssemblyPanelButton.disabled = !hasResult;
  if (els.applyCleanupButton) els.applyCleanupButton.disabled = !hasResult;
  els.downloadButton.disabled = !hasResult;
  if (els.downloadButtonTop) els.downloadButtonTop.disabled = !hasResult;
  if (els.projectExportButton) els.projectExportButton.disabled = !hasResult;
  if (els.projectExportButtonSide) els.projectExportButtonSide.disabled = !hasResult;
  if (els.mobileProjectExportButton) els.mobileProjectExportButton.disabled = !hasResult;
  if (els.printA4Button) els.printA4Button.disabled = !hasResult;
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
  } else {
    els.resultPreview.removeAttribute("src");
    els.resultMetrics.innerHTML = `
      <span class="metric-card metric-grid"><small>格数</small><strong>0×0</strong></span>
      <span class="metric-card metric-difficulty"><small>难度</small><strong>-</strong></span>
      <span class="metric-card metric-time"><small>耗时</small><strong>-</strong></span>
      <span class="metric-card metric-size"><small>尺寸</small><strong>-</strong></span>
    `;
    if (els.statsTotalLabel) els.statsTotalLabel.textContent = "未生成";
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
    const row = document.createElement("button");
    row.type = "button";
    row.className = "stat-row";
    row.title = `高亮 ${item.code}，共 ${formatCount(item.count)} 颗`;
    row.setAttribute("aria-label", `高亮色号 ${item.code}，${formatCount(item.count)} 颗`);

    const swatch = document.createElement("span");
    swatch.className = "stat-swatch";
    swatch.style.backgroundColor = rgb(item);

    const code = document.createElement("span");
    code.className = `stat-code${isDark(item.rgb) ? " light-text" : ""}`;
    code.textContent = item.code;

    const count = document.createElement("span");
    count.className = "stat-count";
    count.textContent = formatCount(item.count);

    row.append(swatch, code, count);
    row.addEventListener("click", () => {
      openAssemblyPlayer();
      selectAssemblyColor(item.code);
    });
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
  els.modalPreviewImage.src = state.previewUrl || state.chartUrl;
  setPreviewZoom(1);
  els.previewModal.showModal();
}

function setPreviewZoom(value) {
  state.previewZoom = clamp(value, 0.25, 5);
  els.modalPreviewImage.style.transform = `scale(${state.previewZoom})`;
}

function downloadPreviewImage() {
  if (!state.chartUrl) return;
  downloadUrl(state.chartUrl, buildPreviewDownloadName());
  setStatus("已下载预览图");
}

async function downloadPattern() {
  if (!state.grid.length) {
    if (state.sourceDataUrl) {
      const generated = await processImage();
      if (!generated) return;
    } else {
      createBlankBoard({ openEditorAfterCreate: false });
    }
  }

  const exportGrid = getExportGrid();
  const exportStats = calculateStats(exportGrid);
  const tileSize = getSelectedTileSize();
  if (tileSize && (exportGrid[0]?.length > tileSize || exportGrid.length > tileSize)) {
    await downloadSplitPattern(tileSize, exportGrid);
    return;
  }

  const canvas = createChartCanvas(exportGrid, exportStats, {
    cell: getDownloadCellSize(),
    margin: 88,
    showCodes: true,
    minLongSide: EXPORT_MIN_LONG_SIDE,
    subtitle: getExportSubtitle(),
  });
  downloadUrl(canvas.toDataURL("image/png"), buildDownloadName());
  setStatus("已下载");
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
  const mirrorLabel = getMirrorLabel();
  const pageCanvases = [];

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
    pageCanvases.push(canvas);
  }

  const materialCanvases = createA4MaterialListCanvases(printSet, grid, {
    marginMm,
    mirrorLabel,
  });

  try {
    setStatus("正在生成A4打印 PDF...");
    await exportA4PrintPdf(materialCanvases, pageCanvases, orientation);
    setStatus(`已生成A4打印 PDF：${materialCanvases.length} 页清单，${pageCanvases.length} 页图纸`);
  } catch (error) {
    console.error("A4 PDF export failed", error);
    alert("PDF 导出失败，请检查网络后重试。");
    setStatus("A4 PDF 导出失败");
  }
}

let jsPdfLoadPromise = null;

function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (jsPdfLoadPromise) return jsPdfLoadPromise;

  jsPdfLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-libms-jspdf]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.jspdf?.jsPDF), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = JSPDF_SCRIPT_URL;
    script.async = true;
    script.dataset.libmsJspdf = "true";
    script.onload = () => {
      if (window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error("jsPDF 未正确加载"));
    };
    script.onerror = () => reject(new Error("jsPDF 加载失败"));
    document.head.append(script);
  });

  return jsPdfLoadPromise;
}

async function exportA4PrintPdf(materialCanvases, pageCanvases, orientation) {
  const JsPDF = await loadJsPdf();
  const isLandscape = orientation === "landscape";
  const doc = new JsPDF({
    orientation,
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const pageWidthMm = isLandscape ? A4_SIZE_MM.height : A4_SIZE_MM.width;
  const pageHeightMm = isLandscape ? A4_SIZE_MM.width : A4_SIZE_MM.height;
  const pages = [...materialCanvases, ...pageCanvases];

  pages.forEach((canvas, index) => {
    if (index > 0) doc.addPage();
    doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageWidthMm, pageHeightMm, undefined, "FAST");
  });

  doc.save(buildA4DownloadName("pdf"));
}

function createA4MaterialListCanvases(printSet, grid, details = {}) {
  const pageWidth = printSet.pageWidth;
  const pageHeight = printSet.pageHeight;
  const margin = Math.max(96, Math.round(printSet.marginPx * 0.88));
  const stats = calculateStats(grid);
  const total = stats.reduce((sum, item) => sum + item.count, 0);
  const difficulty = getPatternDifficulty(grid, stats);
  const columns = Math.max(3, Math.floor((pageWidth - margin * 2) / 420));
  const itemHeight = 92;
  const startY = 650;
  const rowsPerPage = Math.max(8, Math.floor((pageHeight - startY - margin) / itemHeight));
  const itemsPerPage = Math.max(columns, columns * rowsPerPage);
  const pageCount = Math.max(1, Math.ceil(stats.length / itemsPerPage));
  const canvases = [];
  const generatedAt = new Date().toLocaleString("zh-CN");

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = pageWidth;
    canvas.height = pageHeight;
    const context = canvas.getContext("2d");
    const slice = stats.slice(pageIndex * itemsPerPage, (pageIndex + 1) * itemsPerPage);

    context.fillStyle = "#fffefa";
    context.fillRect(0, 0, pageWidth, pageHeight);
    drawMaterialListHeader(context, {
      pageWidth,
      pageHeight,
      margin,
      pageIndex,
      pageCount,
      generatedAt,
      total,
      statsCount: stats.length,
      difficulty,
      mirrorLabel: details.mirrorLabel,
      marginMm: details.marginMm,
      pages: printSet.tiles.length,
      columns: grid[0]?.length || 0,
      rows: grid.length,
    });

    drawMaterialListItems(context, slice, {
      margin,
      startY,
      pageWidth,
      columns,
      itemHeight,
      indexOffset: pageIndex * itemsPerPage,
    });

    context.fillStyle = "rgba(17, 24, 39, 0.48)";
    context.font = `700 24px ${CANVAS_FONT_STACK}`;
    context.textAlign = "center";
    context.fillText(
      `材料清单 ${pageIndex + 1} / ${pageCount}`,
      pageWidth / 2,
      pageHeight - Math.max(44, margin * 0.4),
    );

    canvases.push(canvas);
  }

  return canvases;
}

function drawMaterialListHeader(context, details) {
  const {
    pageWidth,
    margin,
    pageIndex,
    pageCount,
    generatedAt,
    total,
    statsCount,
    difficulty,
    mirrorLabel,
    marginMm,
    pages,
    columns,
    rows,
  } = details;
  const logoSize = 108;
  const logoX = margin;
  const logoY = 68;
  drawLogoMark(context, logoX, logoY, logoSize);

  const textX = logoX + logoSize + 28;
  context.textAlign = "left";
  context.fillStyle = "#111827";
  context.font = `900 42px ${CANVAS_FONT_STACK}`;
  context.fillText("时里白造物拼豆图纸 - 精确材料清单", textX, 108, pageWidth - textX - margin);
  context.fillStyle = "#4b5563";
  context.font = `800 24px ${CANVAS_FONT_STACK}`;
  context.fillText("时里白造物 · A4 Printable PDF", textX, 148, pageWidth - textX - margin);
  context.font = `700 20px ${CANVAS_FONT_STACK}`;
  context.fillText(`生成时间：${generatedAt}`, textX, 186, pageWidth - textX - margin);

  context.textAlign = "right";
  context.fillStyle = "rgba(17, 24, 39, 0.52)";
  context.font = `800 22px ${CANVAS_FONT_STACK}`;
  context.fillText(`清单 ${pageIndex + 1}/${pageCount}`, pageWidth - margin, 112);

  context.strokeStyle = "rgba(17, 24, 39, 0.16)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(margin, 228);
  context.lineTo(pageWidth - margin, 228);
  context.stroke();

  const cards = [
    ["格数", `${columns}×${rows}`],
    ["难度", difficulty.label],
    ["预计耗时", difficulty.timeLabel],
    ["尺寸", formatFinishedSize(columns, rows).replace(" x ", "×")],
    ["A4", `${pages} 页`],
    ["材料", `${statsCount} 色 · ${formatCount(total)} 颗`],
  ];
  const gap = 18;
  const cardColumns = Math.min(3, cards.length);
  const cardWidth = (pageWidth - margin * 2 - gap * (cardColumns - 1)) / cardColumns;
  const cardHeight = 118;
  cards.forEach(([label, value], index) => {
    const row = Math.floor(index / cardColumns);
    const col = index % cardColumns;
    const x = margin + col * (cardWidth + gap);
    const y = 276 + row * (cardHeight + gap);
    context.fillStyle = "#ffffff";
    roundedRect(context, x, y, cardWidth, cardHeight, 28);
    context.fill();
    context.strokeStyle = "rgba(17, 24, 39, 0.10)";
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = "#8ba0bc";
    context.font = `800 22px ${CANVAS_FONT_STACK}`;
    context.textAlign = "center";
    context.fillText(label, x + cardWidth / 2, y + 42);
    context.fillStyle = "#111827";
    context.font = `900 30px ${CANVAS_FONT_STACK}`;
    context.fillText(value, x + cardWidth / 2, y + 84, cardWidth - 28);
  });

  const noteY = 276 + 2 * (cardHeight + gap) + 8;
  context.fillStyle = "#f4f5f7";
  roundedRect(context, margin, noteY, pageWidth - margin * 2, 64, 26);
  context.fill();
  context.fillStyle = "#6b7280";
  context.font = `800 20px ${CANVAS_FONT_STACK}`;
  context.textAlign = "center";
  context.fillText(
    `${getChartPaletteLabel()} · 页边距 ${marginMm}mm${mirrorLabel ? ` · ${mirrorLabel}` : ""} · 请按色号和数量备料`,
    pageWidth / 2,
    noteY + 40,
    pageWidth - margin * 2 - 48,
  );
}

function drawMaterialListItems(context, items, details) {
  const { margin, startY, pageWidth, columns, itemHeight, indexOffset } = details;
  const columnWidth = (pageWidth - margin * 2) / columns;
  context.textAlign = "left";

  items.forEach((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + col * columnWidth;
    const y = startY + row * itemHeight;
    const swatch = 54;
    const color = rgb(item);

    context.fillStyle = "#ffffff";
    roundedRect(context, x + 5, y + 5, columnWidth - 18, itemHeight - 14, 20);
    context.fill();
    context.strokeStyle = "rgba(17, 24, 39, 0.10)";
    context.lineWidth = 2;
    context.stroke();

    context.fillStyle = color;
    roundedRect(context, x + 22, y + 19, swatch, swatch, 14);
    context.fill();
    context.strokeStyle = "rgba(17, 24, 39, 0.20)";
    context.lineWidth = 2;
    context.stroke();

    context.fillStyle = isDark(item.rgb) ? "#ffffff" : "#111827";
    context.font = `900 16px ${CANVAS_FONT_STACK}`;
    context.textAlign = "center";
    context.fillText(item.code, x + 22 + swatch / 2, y + 52, swatch - 8);

    context.textAlign = "left";
    context.fillStyle = "#111827";
    context.font = `900 22px ${CANVAS_FONT_STACK}`;
    context.fillText(item.code, x + 92, y + 42, columnWidth - 110);
    context.fillStyle = "#8ba0bc";
    context.font = `900 20px ${CANVAS_FONT_STACK}`;
    context.fillText(`${formatCount(item.count)} 颗`, x + 92, y + 70, columnWidth - 110);

    context.fillStyle = "rgba(17, 24, 39, 0.35)";
    context.font = `700 14px ${CANVAS_FONT_STACK}`;
    context.textAlign = "right";
    context.fillText(`#${indexOffset + index + 1}`, x + columnWidth - 24, y + 38);
  });
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
  const value = els.tileSizeSelect?.value || "0";
  return value === "smart" ? getSmartTileSize(state.grid) : Number(value);
}

function getSmartTileSize(grid) {
  const rows = grid.length;
  const columns = grid[0]?.length || 0;
  if (!rows || !columns) return 52;
  const candidates = [52, 78, 104];
  return candidates
    .map((size) => {
      const count = Math.ceil(columns / size) * Math.ceil(rows / size);
      const capacity = count * size * size;
      const wasteRatio = (capacity - columns * rows) / capacity;
      const oversizePenalty = size > Math.max(columns, rows) ? 0.12 : 0;
      return { size, score: count + wasteRatio + oversizePenalty };
    })
    .sort((a, b) => a.score - b.score || a.size - b.size)[0].size;
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
  return isMirrorEnabled() ? mirrorGrid(state.grid) : cloneGrid(state.grid);
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
  const smart = els.tileSizeSelect?.value === "smart" ? "智能 · " : "";
  return `${smart}${tileSize} 版 · ${columns * rows} 块`;
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

function sanitizeFileName(value) {
  return String(value || "libai-project")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function buildDownloadName() {
  const base = getSafeSchemeFilename() || state.sourceName.replace(/\.[^.]+$/, "") || "bead-pattern";
  return `${base}${isMirrorEnabled() ? "-mirror" : ""}-bead-pattern.png`;
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

class HardCodedEngine {
  constructor(canvas, matrix, config = {}) {
    this.canvas = typeof canvas === "string" ? document.getElementById(canvas) : canvas;
    this.ctx = this.canvas?.getContext("2d");
    this.matrix = matrix;
    this.totalCols = matrix[0]?.length || 0;
    this.totalRows = matrix.length;
    this.boardSize = config.boardSize || Math.max(this.totalCols, this.totalRows, 1);
    this.currentBoardRow = config.currentBoardRow || 0;
    this.currentBoardCol = config.currentBoardCol || 0;
    this.fixedCellSize = Boolean(config.cellSize);
    this.cellSize = config.cellSize || this.getDefaultCellSize(this.boardSize);
    this.axisSize = config.axisSize || 34;
    this.config = {
      maskColor: "rgba(30, 30, 30, 0.85)",
      highlightColor: null,
      showCellText: true,
      completedSets: new Set(),
      onToggle: null,
      onHover: null,
      ...config,
    };
    this.refreshBoardBounds();
    this.completedSets = new Set(this.config.completedSets || []);
    this.hoverCell = null;
    this.pointers = new Map();
    this.pinchState = null;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.minScale = 0.18;
    this.maxScale = 5;
    this.dpr = this.getDevicePixelRatio();
    this.offscreenCanvas = document.createElement("canvas");
    this.offscreenCtx = this.offscreenCanvas.getContext("2d");
    this.configureOffscreenCanvas(true);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    if (this.canvas?.parentElement) this.resizeObserver.observe(this.canvas.parentElement);
    this.resize({ fit: true });
    this.preRenderStaticMap();
    this.render();
  }

  getDefaultCellSize(boardSize) {
    if (boardSize <= 52) return 32;
    if (boardSize <= 78) return 28;
    if (boardSize <= 104) return 24;
    return 20;
  }

  getDevicePixelRatio() {
    return Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  }

  getOffscreenPixelRatio() {
    const maxCanvasSide = 8192;
    const maxCanvasPixels = 32000000;
    const sideScale = Math.min(maxCanvasSide / this.boardWidth, maxCanvasSide / this.boardHeight);
    const areaScale = Math.sqrt(maxCanvasPixels / Math.max(1, this.boardWidth * this.boardHeight));
    return Math.max(1, Math.min(this.dpr, sideScale, areaScale));
  }

  disableImageSmoothing(context) {
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.mozImageSmoothingEnabled = false;
    context.webkitImageSmoothingEnabled = false;
    context.msImageSmoothingEnabled = false;
  }

  configureOffscreenCanvas(force = false) {
    if (!this.offscreenCanvas || !this.offscreenCtx) return;
    this.offscreenDpr = this.getOffscreenPixelRatio();
    const width = Math.max(1, Math.round(this.boardWidth * this.offscreenDpr));
    const height = Math.max(1, Math.round(this.boardHeight * this.offscreenDpr));
    if (force || this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;
    }
    this.offscreenCtx.setTransform(this.offscreenDpr, 0, 0, this.offscreenDpr, 0, 0);
    this.disableImageSmoothing(this.offscreenCtx);
  }

  refreshBoardBounds() {
    this.boardSize = Math.max(1, Number(this.config.boardSize || this.boardSize || 52));
    if (!this.fixedCellSize) this.cellSize = this.getDefaultCellSize(this.boardSize);
    const maxBoardRow = Math.max(0, Math.ceil(this.totalRows / this.boardSize) - 1);
    const maxBoardCol = Math.max(0, Math.ceil(this.totalCols / this.boardSize) - 1);
    this.currentBoardRow = clamp(Number(this.config.currentBoardRow || 0), 0, maxBoardRow);
    this.currentBoardCol = clamp(Number(this.config.currentBoardCol || 0), 0, maxBoardCol);
    this.startRow = this.currentBoardRow * this.boardSize;
    this.startCol = this.currentBoardCol * this.boardSize;
    this.endRow = Math.min(this.startRow + this.boardSize, this.totalRows);
    this.endCol = Math.min(this.startCol + this.boardSize, this.totalCols);
    this.rows = Math.max(0, this.endRow - this.startRow);
    this.cols = Math.max(0, this.endCol - this.startCol);
    this.boardWidth = this.axisSize + this.cols * this.cellSize;
    this.boardHeight = this.axisSize + this.rows * this.cellSize;
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.pointers.clear();
    this.pinchState = null;
  }

  resize(options = {}) {
    if (!this.canvas || !this.ctx) return;
    const parent = this.canvas.parentElement;
    const width = Math.max(320, parent?.clientWidth || window.innerWidth);
    const height = Math.max(320, parent?.clientHeight || window.innerHeight - 120);
    this.viewportWidth = width;
    this.viewportHeight = height;
    const nextDpr = this.getDevicePixelRatio();
    const shouldRebake = nextDpr !== this.dpr;
    this.dpr = nextDpr;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    if (shouldRebake) {
      this.configureOffscreenCanvas(true);
      this.preRenderStaticMap();
    }
    if (options.fit) this.fitToViewport();
    else this.clampViewport();
    this.render();
  }

  fitToViewport() {
    const fitScale = Math.min(
      (this.viewportWidth - 28) / this.boardWidth,
      (this.viewportHeight - 28) / this.boardHeight,
      1.35,
    );
    this.scale = clamp(fitScale, this.minScale, this.maxScale);
    this.offsetX = (this.viewportWidth - this.boardWidth * this.scale) / 2;
    this.offsetY = (this.viewportHeight - this.boardHeight * this.scale) / 2;
    this.clampViewport();
  }

  updateConfig(newConfig = {}) {
    const nextHighlight = newConfig.highlightColor ?? this.config.highlightColor;
    const nextShowText = newConfig.showCellText ?? this.config.showCellText;
    const nextBoardSize = newConfig.boardSize ?? this.config.boardSize ?? this.boardSize;
    const nextBoardRow = newConfig.currentBoardRow ?? this.config.currentBoardRow ?? this.currentBoardRow;
    const nextBoardCol = newConfig.currentBoardCol ?? this.config.currentBoardCol ?? this.currentBoardCol;
    const nextFocusKey = newConfig.focusKey ?? this.config.focusKey ?? "";
    const needsBake =
      nextHighlight !== this.config.highlightColor ||
      nextShowText !== this.config.showCellText ||
      nextBoardSize !== (this.config.boardSize ?? this.boardSize) ||
      nextBoardRow !== (this.config.currentBoardRow ?? this.currentBoardRow) ||
      nextBoardCol !== (this.config.currentBoardCol ?? this.currentBoardCol) ||
      nextFocusKey !== (this.config.focusKey ?? "") ||
      newConfig.matrix;
    this.config = { ...this.config, ...newConfig };
    if (newConfig.matrix) {
      this.matrix = newConfig.matrix;
      this.totalCols = this.matrix[0]?.length || 0;
      this.totalRows = this.matrix.length;
    }
    if (needsBake) {
      this.refreshBoardBounds();
      this.configureOffscreenCanvas(true);
      this.fitToViewport();
    }
    if (newConfig.completedSets) this.completedSets = new Set(newConfig.completedSets);
    if (needsBake) this.preRenderStaticMap();
    this.render();
  }

  preRenderStaticMap() {
    const ctx = this.offscreenCtx;
    const size = this.cellSize;
    const axis = this.axisSize;
    const { highlightColor, maskColor, showCellText, focusCells } = this.config;

    this.configureOffscreenCanvas();
    ctx.clearRect(0, 0, this.boardWidth, this.boardHeight);
    this.disableImageSmoothing(ctx);
    ctx.fillStyle = "#fffdf7";
    ctx.fillRect(0, 0, this.boardWidth, this.boardHeight);

    ctx.fillStyle = "#e8eefb";
    ctx.fillRect(0, 0, this.boardWidth, axis);
    ctx.fillRect(0, 0, axis, this.boardHeight);
    ctx.fillStyle = "#526078";
    ctx.font = `900 11px ${CANVAS_FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let c = 0; c < this.cols; c += 1) {
      if (c % 10 === 0) ctx.fillText(String(c + 1), axis + c * size + size / 2, axis / 2);
    }
    for (let r = 0; r < this.rows; r += 1) {
      if (r % 10 === 0) ctx.fillText(String(r + 1), axis / 2, axis + r * size + size / 2);
    }

    const sequenceMap = new Map();
    if (highlightColor) {
      let counter = 1;
      for (let r = 0; r < this.totalRows; r += 1) {
        for (let c = 0; c < this.totalCols; c += 1) {
          const beadColor = this.getCellColor(this.matrix[r]?.[c]);
          if (beadColor === highlightColor) {
            if (r >= this.startRow && r < this.endRow && c >= this.startCol && c < this.endCol) {
              sequenceMap.set(`${r}_${c}`, counter);
            }
            counter += 1;
          }
        }
      }
    }

    for (let r = this.startRow; r < this.endRow; r += 1) {
      for (let c = this.startCol; c < this.endCol; c += 1) {
        const bead = this.matrix[r][c];
        const beadColor = this.getCellColor(bead);
        const localCol = c - this.startCol;
        const localRow = r - this.startRow;
        const x = axis + localCol * size;
        const y = axis + localRow * size;
        ctx.save();

        if (beadColor) {
          ctx.fillStyle = beadColor;
          ctx.fillRect(x, y, size, size);
          if ((highlightColor && beadColor !== highlightColor) || (focusCells && !focusCells.has(`${r}_${c}`))) {
            ctx.fillStyle = maskColor;
            ctx.fillRect(x, y, size, size);
          }
        } else {
          ctx.fillStyle = "#fffdf7";
          ctx.fillRect(x, y, size, size);
        }

        if (highlightColor && beadColor === highlightColor) {
          const seqNum = sequenceMap.get(`${r}_${c}`);
          const seqText = String(seqNum || "");
          ctx.fillStyle = this.getContrastColor(beadColor);
          const seqSize = seqText.length >= 5 ? 9 : seqText.length >= 4 ? 11 : size >= 28 ? 14 : 10;
          ctx.font = `900 ${seqSize}px ${CANVAS_FONT_STACK}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(seqText, x + size / 2, y + size / 2, size * 0.82);
          ctx.strokeStyle = "#00ff66";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
        } else if (showCellText && bead?.code && size >= 18) {
          ctx.fillStyle = this.getContrastColor(beadColor);
          ctx.globalAlpha = highlightColor ? 0.22 : 0.72;
          ctx.font = `900 ${size >= 22 ? 9 : 7}px ${CANVAS_FONT_STACK}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(bead.code, x + size / 2, y + size / 2, size * 0.82);
        }

        ctx.restore();
      }
    }

    this.drawGridLines(ctx);
  }

  drawGridLines(ctx) {
    const size = this.cellSize;
    const axis = this.axisSize;
    const width = this.cols * size;
    const height = this.rows * size;
    ctx.save();
    ctx.lineCap = "butt";

    for (let c = 0; c <= this.cols; c += 1) {
      const x = axis + c * size + 0.5;
      const isTen = c % 10 === 0;
      const isFive = c % 5 === 0;
      ctx.beginPath();
      ctx.setLineDash(isFive && !isTen ? [6, 5] : []);
      ctx.strokeStyle = isTen ? "rgba(75, 85, 99, 0.92)" : isFive ? "rgba(92, 101, 116, 0.74)" : "rgba(107, 114, 128, 0.48)";
      ctx.lineWidth = isTen ? 2.5 : isFive ? 1.6 : 1;
      ctx.moveTo(x, axis);
      ctx.lineTo(x, axis + height);
      ctx.stroke();
    }

    for (let r = 0; r <= this.rows; r += 1) {
      const y = axis + r * size + 0.5;
      const isTen = r % 10 === 0;
      const isFive = r % 5 === 0;
      ctx.beginPath();
      ctx.setLineDash(isFive && !isTen ? [6, 5] : []);
      ctx.strokeStyle = isTen ? "rgba(75, 85, 99, 0.92)" : isFive ? "rgba(92, 101, 116, 0.74)" : "rgba(107, 114, 128, 0.48)";
      ctx.lineWidth = isTen ? 2.5 : isFive ? 1.6 : 1;
      ctx.moveTo(axis, y);
      ctx.lineTo(axis + width, y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(17, 24, 39, 0.82)";
    ctx.lineWidth = 2.8;
    ctx.strokeRect(axis + 0.5, axis + 0.5, width, height);
    ctx.restore();
  }

  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewportWidth, this.viewportHeight);
    this.disableImageSmoothing(ctx);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    ctx.drawImage(
      this.offscreenCanvas,
      0,
      0,
      this.offscreenCanvas.width,
      this.offscreenCanvas.height,
      0,
      0,
      this.boardWidth,
      this.boardHeight,
    );
    this.drawHoverOverlay(ctx);
    this.completedSets.forEach((coordKey) => {
      const [r, c] = coordKey.split("_").map(Number);
      if (r >= this.startRow && r < this.endRow && c >= this.startCol && c < this.endCol) {
        this.drawCheckMark(c, r);
      }
    });
    ctx.restore();
  }

  drawHoverOverlay(ctx) {
    if (!this.hoverCell) return;
    const { row, col } = this.hoverCell;
    if (row < this.startRow || row >= this.endRow || col < this.startCol || col >= this.endCol) return;
    const localRow = row - this.startRow;
    const localCol = col - this.startCol;
    const size = this.cellSize;
    const axis = this.axisSize;
    ctx.save();
    ctx.fillStyle = "rgba(0, 113, 227, 0.16)";
    ctx.fillRect(axis, axis + localRow * size, this.cols * size, size);
    ctx.fillRect(axis + localCol * size, axis, size, this.rows * size);
    ctx.fillStyle = "rgba(255, 179, 64, 0.30)";
    ctx.fillRect(axis + localCol * size, axis + localRow * size, size, size);
    ctx.strokeStyle = "rgba(17, 24, 39, 0.72)";
    ctx.lineWidth = 2;
    ctx.strokeRect(axis + localCol * size + 1, axis + localRow * size + 1, size - 2, size - 2);
    ctx.restore();
  }

  drawCheckMark(col, row) {
    const ctx = this.ctx;
    const size = this.cellSize;
    const x = this.axisSize + (col - this.startCol) * size;
    const y = this.axisSize + (row - this.startRow) * size;
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "#00a552";
    ctx.font = `900 ${Math.max(10, size * 0.55)}px ${CANVAS_FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✓", x + size / 2, y + size / 2 + 0.5);
    ctx.restore();
  }

  handlePointerDown(event) {
    event.preventDefault();
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
    });
    if (this.pointers.size === 2) this.startPinch();
  }

  handlePointerMove(event) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      this.updateHover(event.clientX, event.clientY);
      return;
    }
    event.preventDefault();
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 5) pointer.dragged = true;

    if (this.pointers.size >= 2 && this.pinchState) {
      this.updatePinch();
      return;
    }

    this.offsetX += dx;
    this.offsetY += dy;
    this.clampViewport();
    this.updateHover(event.clientX, event.clientY);
    this.render();
  }

  handlePointerUp(event) {
    const pointer = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    this.canvas.releasePointerCapture?.(event.pointerId);
    if (this.pinchState && this.pointers.size < 2) {
      this.pinchState = null;
      return;
    }
    if (pointer && !pointer.dragged) {
      const cell = this.getCellAtClient(event.clientX, event.clientY);
      if (cell && this.matrix[cell.row]?.[cell.col]) {
        this.config.onToggle?.(cell.row, cell.col);
      }
    }
  }

  handlePointerCancel(event) {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchState = null;
  }

  handlePointerLeave() {
    this.hoverCell = null;
    this.config.onHover?.("", "");
    this.render();
  }

  handleWheel(event) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    this.zoomAt(event.clientX, event.clientY, this.scale * factor);
  }

  startPinch() {
    const [a, b] = [...this.pointers.values()];
    const center = this.getPointerCenter(a, b);
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    this.pinchState = {
      distance,
      scale: this.scale,
      boardX: (center.x - this.canvas.getBoundingClientRect().left - this.offsetX) / this.scale,
      boardY: (center.y - this.canvas.getBoundingClientRect().top - this.offsetY) / this.scale,
    };
  }

  updatePinch() {
    const [a, b] = [...this.pointers.values()];
    const center = this.getPointerCenter(a, b);
    const rect = this.canvas.getBoundingClientRect();
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const nextScale = clamp((this.pinchState.scale * distance) / this.pinchState.distance, this.minScale, this.maxScale);
    this.scale = nextScale;
    this.offsetX = center.x - rect.left - this.pinchState.boardX * nextScale;
    this.offsetY = center.y - rect.top - this.pinchState.boardY * nextScale;
    a.dragged = true;
    b.dragged = true;
    this.clampViewport();
    this.render();
  }

  getPointerCenter(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  }

  zoomAt(clientX, clientY, nextScale) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const boardX = (sx - this.offsetX) / this.scale;
    const boardY = (sy - this.offsetY) / this.scale;
    this.scale = clamp(nextScale, this.minScale, this.maxScale);
    this.offsetX = sx - boardX * this.scale;
    this.offsetY = sy - boardY * this.scale;
    this.clampViewport();
    this.render();
  }

  updateHover(clientX, clientY) {
    const cell = this.getCellAtClient(clientX, clientY);
    const nextKey = cell ? `${cell.row}_${cell.col}` : "";
    const currentKey = this.hoverCell ? `${this.hoverCell.row}_${this.hoverCell.col}` : "";
    if (nextKey === currentKey) return;
    this.hoverCell = cell;
    this.config.onHover?.(cell ? String(cell.row) : "", cell ? String(cell.col) : "");
    this.render();
  }

  getCellAtClient(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const boardX = (clientX - rect.left - this.offsetX) / this.scale;
    const boardY = (clientY - rect.top - this.offsetY) / this.scale;
    const localCol = Math.floor((boardX - this.axisSize) / this.cellSize);
    const localRow = Math.floor((boardY - this.axisSize) / this.cellSize);
    if (localRow < 0 || localCol < 0 || localRow >= this.rows || localCol >= this.cols) return null;
    return { row: this.startRow + localRow, col: this.startCol + localCol };
  }

  getCellColor(bead) {
    return bead ? rgb(bead) : "";
  }

  getContrastColor(color) {
    const match = String(color || "").match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
    const values = match
      ? [Number(match[1]), Number(match[2]), Number(match[3])]
      : /^#([a-f\d]{6})$/i.test(color)
        ? [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]
        : [255, 255, 255];
    const yiq = (values[0] * 299 + values[1] * 587 + values[2] * 114) / 1000;
    return yiq >= 128 ? "#111827" : "#ffffff";
  }

  clampViewport() {
    const slackX = this.viewportWidth * 0.72;
    const slackY = this.viewportHeight * 0.72;
    this.offsetX = clamp(this.offsetX, this.viewportWidth - this.boardWidth * this.scale - slackX, slackX);
    this.offsetY = clamp(this.offsetY, this.viewportHeight - this.boardHeight * this.scale - slackY, slackY);
  }
}

function openAssemblyPlayer() {
  if (!state.grid.length) {
    setStatus("请先生成图纸，再开始拼");
    return;
  }
  state.playStorageKey = getAssemblyStorageKey();
  state.playCompletedBeads = loadAssemblyProgress(state.playStorageKey);
  state.playActiveCode = "";
  state.currentSelectedColor = null;
  state.assemblyBoardRow = 0;
  state.assemblyBoardCol = 0;
  state.assemblyNavigationMode = "color";
  state.assemblyNavigationIndex = 0;
  state.assemblyUndo = [];
  startAssemblyTimer();
  updateAssemblyNavigationUi();
  syncAssemblyFocusMode();
  renderAssemblyBoardPicker();
  renderAssemblyColorList();
  pushAssemblyHistoryState();
  els.assemblyModal?.showModal();
  requestAnimationFrame(() => {
    renderInteractiveBoard();
    updateAssemblyProgressUi();
  });
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
    const saved = raw ? JSON.parse(raw) : [];
    if (Array.isArray(saved)) {
      state.assemblyElapsedMs = 0;
      return new Set(saved);
    }
    state.assemblyElapsedMs = Math.max(0, Number(saved?.elapsedMs || 0));
    return new Set(Array.isArray(saved?.completed) ? saved.completed : []);
  } catch {
    state.assemblyElapsedMs = 0;
    return new Set();
  }
}

function saveAssemblyProgress() {
  if (!state.playStorageKey) return;
  localStorage.setItem(
    state.playStorageKey,
    JSON.stringify({
      completed: [...state.playCompletedBeads],
      elapsedMs: getAssemblyElapsedMs(),
    }),
  );
}

function getAssemblyElapsedMs() {
  return state.assemblyElapsedMs + (state.assemblyTimerRunning ? Date.now() - state.assemblyTimerStartedAt : 0);
}

function startAssemblyTimer() {
  state.assemblyTimerRunning = true;
  state.assemblyTimerStartedAt = Date.now();
  window.clearInterval(state.assemblyTimerInterval);
  state.assemblyTimerInterval = window.setInterval(updateAssemblyTimerUi, 1000);
  updateAssemblyTimerUi();
}

function toggleAssemblyTimer() {
  if (state.assemblyTimerRunning) {
    state.assemblyElapsedMs = getAssemblyElapsedMs();
    state.assemblyTimerRunning = false;
    state.assemblyTimerStartedAt = 0;
  } else {
    state.assemblyTimerRunning = true;
    state.assemblyTimerStartedAt = Date.now();
  }
  saveAssemblyProgress();
  updateAssemblyTimerUi();
}

function stopAssemblyTimer() {
  if (state.assemblyTimerRunning) state.assemblyElapsedMs = getAssemblyElapsedMs();
  state.assemblyTimerRunning = false;
  state.assemblyTimerStartedAt = 0;
  window.clearInterval(state.assemblyTimerInterval);
  state.assemblyTimerInterval = 0;
  saveAssemblyProgress();
  updateAssemblyTimerUi();
}

function updateAssemblyTimerUi() {
  const seconds = Math.floor(getAssemblyElapsedMs() / 1000);
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const rest = String(seconds % 60).padStart(2, "0");
  if (els.assemblyTimer) els.assemblyTimer.textContent = `${hours}:${minutes}:${rest}`;
  if (els.assemblyTimerToggle) els.assemblyTimerToggle.textContent = state.assemblyTimerRunning ? "暂停计时" : "继续计时";
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
    if (state.assemblyNavigationMode === "color") {
      state.assemblyNavigationIndex = Math.max(0, state.stats.findIndex((item) => item.code === code));
    }
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
  stopAssemblyTimer();
  destroyAssemblyEngine();
  document.body.classList.remove("is-focus-mode");
  document.body.dataset.activeBeadColor = "";
  document.documentElement.style.setProperty("--active-bead-color", "transparent");
  hideExitModal();
  renderAssemblyColorList();
}

function destroyAssemblyEngine() {
  state.assemblyEngine?.destroy();
  state.assemblyEngine = null;
}

function getAssemblyBoardSize() {
  const selectedSize = getSelectedTileSize();
  if (selectedSize > 0) return selectedSize;
  return Math.max(state.grid.length, state.grid[0]?.length || 0, 1);
}

function getAssemblyBoardMeta() {
  const rows = state.grid.length;
  const columns = state.grid[0]?.length || 0;
  const boardSize = getAssemblyBoardSize();
  const tileRows = Math.max(1, Math.ceil(rows / boardSize));
  const tileColumns = Math.max(1, Math.ceil(columns / boardSize));
  state.assemblyBoardRow = clamp(state.assemblyBoardRow || 0, 0, tileRows - 1);
  state.assemblyBoardCol = clamp(state.assemblyBoardCol || 0, 0, tileColumns - 1);
  const startRow = state.assemblyBoardRow * boardSize;
  const startCol = state.assemblyBoardCol * boardSize;
  const endRow = Math.min(startRow + boardSize, rows);
  const endCol = Math.min(startCol + boardSize, columns);
  const index = state.assemblyBoardRow * tileColumns + state.assemblyBoardCol + 1;
  const total = tileRows * tileColumns;
  return {
    boardSize,
    tileRows,
    tileColumns,
    startRow,
    startCol,
    endRow,
    endCol,
    index,
    total,
  };
}

function renderAssemblyBoardPicker() {
  if (!els.assemblyBoardPicker || !els.assemblyBoardButtons) return null;
  const meta = getAssemblyBoardMeta();
  els.assemblyBoardPicker.hidden = !state.grid.length;
  if (!state.grid.length) {
    els.assemblyBoardButtons.replaceChildren();
    return meta;
  }

  const rangeText = `第 ${meta.index} / ${meta.total} 板 · 行 ${meta.startRow + 1}-${meta.endRow} · 列 ${
    meta.startCol + 1
  }-${meta.endCol}`;
  if (els.assemblyBoardLabel) els.assemblyBoardLabel.textContent = `${meta.boardSize} x ${meta.boardSize} 分版`;
  if (els.assemblyBoardRange) els.assemblyBoardRange.textContent = rangeText;

  els.assemblyBoardButtons.replaceChildren();
  for (let row = 0; row < meta.tileRows; row += 1) {
    for (let col = 0; col < meta.tileColumns; col += 1) {
      const button = document.createElement("button");
      const index = row * meta.tileColumns + col + 1;
      button.type = "button";
      button.className = `assembly-board-chip${
        row === state.assemblyBoardRow && col === state.assemblyBoardCol ? " active" : ""
      }`;
      button.textContent = `${index}`;
      button.title = `第 ${index} 板，R${row + 1} C${col + 1}`;
      button.addEventListener("click", () => switchActiveBoard(row, col));
      els.assemblyBoardButtons.append(button);
    }
  }
  return meta;
}

function switchActiveBoard(boardRow, boardCol) {
  state.assemblyBoardRow = boardRow;
  state.assemblyBoardCol = boardCol;
  if (state.assemblyNavigationMode === "block") {
    const meta = getAssemblyBoardMeta();
    state.assemblyNavigationIndex = boardRow * meta.tileColumns + boardCol;
  }
  renderAssemblyBoardPicker();
  renderInteractiveBoard();
  updateAssemblyProgressUi();
}

function renderInteractiveBoard() {
  const canvas = els.assemblyBoard;
  if (!canvas) return;
  const rows = state.grid.length;
  const columns = state.grid[0]?.length || 0;
  const activeColor = getAssemblyActiveColor();
  const meta = renderAssemblyBoardPicker();
  const focusCells = getAssemblyFocusCells();
  state.playHoverRow = "";
  state.playHoverCol = "";
  const signature = `${columns}x${rows}:${meta?.boardSize || 0}:${state.assemblyBoardRow}:${state.assemblyBoardCol}:${
    state.paletteLabel
  }:${state.stats
    .map((item) => `${item.code}:${item.count}`)
    .join(",")}`;
  const config = {
    boardSize: meta?.boardSize || Math.max(columns, rows, 1),
    currentBoardRow: state.assemblyBoardRow,
    currentBoardCol: state.assemblyBoardCol,
    highlightColor: activeColor || null,
    focusCells,
    focusKey: focusCells ? `${state.assemblyNavigationMode}:${state.assemblyNavigationIndex}` : "",
    showCellText: !state.assemblyHideCellText,
    completedSets: state.playCompletedBeads,
    onToggle: toggleAssemblyCoord,
    onHover: setAssemblyCrosshair,
  };

  if (!state.assemblyEngine || state.assemblyEngine.signature !== signature) {
    destroyAssemblyEngine();
    state.assemblyEngine = new HardCodedEngine(canvas, state.grid, config);
    state.assemblyEngine.signature = signature;
  } else {
    state.assemblyEngine.updateConfig(config);
  }
}

function handleAssemblyBoardPointerDown(event) {
  state.assemblyEngine?.handlePointerDown(event);
}

function handleAssemblyBoardPointerMove(event) {
  state.assemblyEngine?.handlePointerMove(event);
}

function handleAssemblyBoardPointerUp(event) {
  state.assemblyEngine?.handlePointerUp(event);
}

function handleAssemblyBoardPointerCancel(event) {
  state.assemblyEngine?.handlePointerCancel(event);
}

function handleAssemblyBoardPointerLeave() {
  state.assemblyEngine?.handlePointerLeave();
}

function handleAssemblyBoardWheel(event) {
  state.assemblyEngine?.handleWheel(event);
}

function setAssemblyCrosshair(row, col) {
  state.playHoverRow = row;
  state.playHoverCol = col;
}

function clearAssemblyCrosshair() {
  state.playHoverRow = "";
  state.playHoverCol = "";
  if (state.assemblyEngine) {
    state.assemblyEngine.hoverCell = null;
    state.assemblyEngine.render();
  }
}

function toggleAssemblyCoord(row, col) {
  const coordKey = `${row}_${col}`;
  state.assemblyUndo.push({ coordKey, completed: state.playCompletedBeads.has(coordKey) });
  if (state.assemblyUndo.length > 100) state.assemblyUndo.shift();
  if (state.playCompletedBeads.has(coordKey)) {
    state.playCompletedBeads.delete(coordKey);
  } else {
    state.playCompletedBeads.add(coordKey);
  }
  saveAssemblyProgress();
  state.assemblyEngine?.updateConfig({ completedSets: state.playCompletedBeads });
  updateAssemblyProgressUi();
  updateAssemblyNavigationUi();
}

function undoAssemblyCompletion() {
  const action = state.assemblyUndo.pop();
  if (!action) return;
  if (action.completed) state.playCompletedBeads.add(action.coordKey);
  else state.playCompletedBeads.delete(action.coordKey);
  saveAssemblyProgress();
  state.assemblyEngine?.updateConfig({ completedSets: state.playCompletedBeads });
  updateAssemblyProgressUi();
  updateAssemblyNavigationUi();
}

function setAssemblyNavigationMode(mode) {
  state.assemblyNavigationMode = ["color", "row", "block"].includes(mode) ? mode : "color";
  state.assemblyNavigationIndex = 0;
  if (state.assemblyNavigationMode !== "color") selectAssemblyColor("");
  applyAssemblyNavigation();
}

function navigateAssembly(direction) {
  const count = getAssemblyNavigationCount();
  if (!count) return;
  state.assemblyNavigationIndex = (state.assemblyNavigationIndex + direction + count) % count;
  applyAssemblyNavigation();
}

function getAssemblyNavigationCount() {
  if (state.assemblyNavigationMode === "color") return state.stats.length;
  if (state.assemblyNavigationMode === "row") return state.grid.length;
  const meta = getAssemblyBoardMeta();
  return meta.total;
}

function applyAssemblyNavigation() {
  if (state.assemblyNavigationMode === "color") {
    selectAssemblyColor(state.stats[state.assemblyNavigationIndex]?.code || "");
  } else if (state.assemblyNavigationMode === "row") {
    const boardSize = getAssemblyBoardSize();
    state.assemblyBoardRow = Math.floor(state.assemblyNavigationIndex / boardSize);
    renderInteractiveBoard();
    updateAssemblyProgressUi();
  } else {
    const meta = getAssemblyBoardMeta();
    state.assemblyBoardRow = Math.floor(state.assemblyNavigationIndex / meta.tileColumns);
    state.assemblyBoardCol = state.assemblyNavigationIndex % meta.tileColumns;
    renderInteractiveBoard();
    updateAssemblyProgressUi();
  }
  updateAssemblyNavigationUi();
}

function getAssemblyFocusCells() {
  if (state.assemblyNavigationMode !== "row") return null;
  const row = clamp(state.assemblyNavigationIndex, 0, state.grid.length - 1);
  const cells = new Set();
  for (let col = 0; col < (state.grid[row]?.length || 0); col += 1) {
    if (state.grid[row][col]) cells.add(`${row}_${col}`);
  }
  return cells;
}

function updateAssemblyNavigationUi() {
  els.assemblyModeButtons.forEach((button) => {
    const active = button.dataset.assemblyMode === state.assemblyNavigationMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (els.assemblyUndoButton) els.assemblyUndoButton.disabled = state.assemblyUndo.length === 0;
}

function navigateToNextIncomplete() {
  const rows = state.grid.length;
  const columns = state.grid[0]?.length || 0;
  if (!rows || !columns) return;
  const meta = getAssemblyBoardMeta();
  const start = meta.startRow * columns + meta.startCol;
  for (let offset = 1; offset <= rows * columns; offset += 1) {
    const index = (start + offset) % (rows * columns);
    const row = Math.floor(index / columns);
    const col = index % columns;
    if (!state.grid[row]?.[col] || state.playCompletedBeads.has(`${row}_${col}`)) continue;
    const boardSize = getAssemblyBoardSize();
    state.assemblyBoardRow = Math.floor(row / boardSize);
    state.assemblyBoardCol = Math.floor(col / boardSize);
    if (state.assemblyNavigationMode === "row") state.assemblyNavigationIndex = row;
    if (state.assemblyNavigationMode === "color") {
      const codeIndex = state.stats.findIndex((item) => item.code === state.grid[row][col].code);
      state.assemblyNavigationIndex = Math.max(0, codeIndex);
      selectAssemblyColor(state.grid[row][col].code);
    }
    renderInteractiveBoard();
    state.assemblyEngine.hoverCell = { row, col };
    state.assemblyEngine.render();
    updateAssemblyProgressUi();
    updateAssemblyNavigationUi();
    return;
  }
  setStatus("当前图纸已全部完成");
}

function resetAssemblyProgress() {
  if (!state.playCompletedBeads.size) return;
  if (!window.confirm("确认清空当前图纸的拼豆进度？")) return;
  state.playCompletedBeads.clear();
  state.assemblyUndo = [];
  saveAssemblyProgress();
  renderInteractiveBoard();
  updateAssemblyProgressUi();
}

function updateAssemblyProgressUi() {
  const meta = getAssemblyBoardMeta();
  const total = state.stats.reduce((sum, item) => sum + item.count, 0);
  let completed = 0;
  let boardTotal = 0;
  let boardCompleted = 0;
  state.playCompletedBeads.forEach((key) => {
    const [row, col] = key.split("_").map(Number);
    if (state.grid[row]?.[col]) completed += 1;
  });
  for (let row = meta.startRow; row < meta.endRow; row += 1) {
    for (let col = meta.startCol; col < meta.endCol; col += 1) {
      if (!state.grid[row]?.[col]) continue;
      boardTotal += 1;
      if (state.playCompletedBeads.has(`${row}_${col}`)) boardCompleted += 1;
    }
  }
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const activeText = state.playActiveCode ? ` · 当前高亮 ${state.playActiveCode}` : "";
  if (els.assemblyProgressLabel) {
    els.assemblyProgressLabel.textContent = `${formatCount(completed)} / ${formatCount(total)} · ${percent}%`;
  }
  if (els.assemblySummary) {
    const modeLabel = { color: "按颜色", row: "逐行", block: "按区块" }[state.assemblyNavigationMode] || "按颜色";
    els.assemblySummary.textContent = `当前第 ${meta.index}/${meta.total} 板：${formatCount(boardCompleted)} / ${formatCount(
      boardTotal,
    )}。${modeLabel}模式，点击格子标记已拼${activeText}。`;
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
  state.editorSelectedCells = new Set();
  state.editorLassoPoints = [];
  state.editorHistory = [];
  state.editorRedo = [];
  state.editorActionSnapshot = null;
  state.editorSymmetry = "none";
  state.editorReferenceImage = null;
  state.assemblyMode = false;
  state.assemblyHighlightCode = "";
  state.paintUndo = [];
  state.replaceUndo = [];
  if (els.editorSymmetrySelect) els.editorSymmetrySelect.value = "none";
  if (els.artworkNameInput) els.artworkNameInput.value = buildGalleryTitle();
  updateEditorPaletteOptions();
  els.editorPaletteSelect.value = getCurrentPaletteKey();
  syncEditorPrefsControls();
  renderEditorLibraryOptions();
  updateEditorToolUi();
  updateEditorFloatingUi();
  updateAssemblyUi();
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
  state.editorTool = ["pencil", "eraser", "eyedropper", "fill", "magic", "lasso", "cut", "copy"].includes(tool)
    ? tool
    : "pencil";
  state.editorSelection = null;
  state.editorLassoPoints = [];
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
  const column = Math.floor((x - EDITOR_MARGIN) / EDITOR_CELL_SIZE);
  const row = Math.floor((y - EDITOR_MARGIN) / EDITOR_CELL_SIZE);
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

  if (state.editorTool === "fill") {
    floodFillEditor(cell.column, cell.row);
    return;
  }

  if (state.editorTool === "magic") {
    selectMagicRegion(cell.column, cell.row);
    return;
  }

  if (state.editorTool === "lasso") {
    state.editorLassoPoints = [{ x: cell.column + 0.5, y: cell.row + 0.5 }];
    state.editorSelectedCells = new Set();
    renderEditorCanvas();
    return;
  }

  if (state.editorTool === "cut" || state.editorTool === "copy") {
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

  if (state.editorTool === "lasso" && state.editorLassoPoints.length) {
    const point = { x: cell.column + 0.5, y: cell.row + 0.5 };
    const previous = state.editorLassoPoints[state.editorLassoPoints.length - 1];
    if (previous.x !== point.x || previous.y !== point.y) {
      state.editorLassoPoints.push(point);
      renderEditorCanvas();
    }
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
  if (state.editorTool === "lasso" && state.editorLassoPoints.length) {
    finalizeLassoSelection();
  }
  if (state.editorFloating) {
    state.editorFloating.dragging = false;
  }
  state.isPainting = false;
  state.lastPaintKey = "";
  commitEditorPointerAction();
}

function beginEditorPointerAction() {
  const mutating = ["pencil", "eraser", "fill", "cut"].includes(state.editorTool);
  state.editorActionSnapshot = mutating ? cloneGrid(state.editorGrid) : null;
}

function commitEditorPointerAction() {
  const snapshot = state.editorActionSnapshot;
  state.editorActionSnapshot = null;
  if (!snapshot || gridsEqual(snapshot, state.editorGrid)) return;
  state.editorHistory.push(snapshot);
  if (state.editorHistory.length > 50) state.editorHistory.shift();
  state.editorRedo = [];
  updateEditorControls();
}

function recordEditorHistory() {
  state.editorHistory.push(cloneGrid(state.editorGrid));
  if (state.editorHistory.length > 50) state.editorHistory.shift();
  state.editorRedo = [];
}

function gridsEqual(a, b) {
  if (a.length !== b.length || (a[0]?.length || 0) !== (b[0]?.length || 0)) return false;
  for (let y = 0; y < a.length; y += 1) {
    for (let x = 0; x < (a[y]?.length || 0); x += 1) {
      if (!sameColor(a[y][x], b[y][x])) return false;
    }
  }
  return true;
}

function undoEditor() {
  const previous = state.editorHistory.pop();
  if (!previous) return;
  state.editorRedo.push(cloneGrid(state.editorGrid));
  state.editorGrid = cloneGrid(previous);
  clearEditorSelection();
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function redoEditor() {
  const next = state.editorRedo.pop();
  if (!next) return;
  state.editorHistory.push(cloneGrid(state.editorGrid));
  state.editorGrid = cloneGrid(next);
  clearEditorSelection();
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function clearEditorSelection() {
  state.editorSelectedCells = new Set();
  state.editorLassoPoints = [];
}

function floodFillEditor(column, row) {
  const source = state.editorGrid[row]?.[column] || null;
  const target = cloneColor(state.selectedColor);
  if (sameColor(source, target)) return;
  const queue = [[column, row]];
  const visited = new Set();
  while (queue.length) {
    const [x, y] = queue.pop();
    const key = `${x}:${y}`;
    if (visited.has(key) || y < 0 || x < 0 || y >= state.editorGrid.length || x >= state.editorGrid[0].length) {
      continue;
    }
    visited.add(key);
    if (!sameColor(state.editorGrid[y][x], source)) continue;
    state.editorGrid[y][x] = cloneColor(target);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  renderEditorCanvas();
  updateReplaceOptions();
}

function selectMagicRegion(column, row) {
  const source = state.editorGrid[row]?.[column] || null;
  const queue = [[column, row]];
  const selected = new Set();
  while (queue.length) {
    const [x, y] = queue.pop();
    const key = `${x}:${y}`;
    if (selected.has(key) || y < 0 || x < 0 || y >= state.editorGrid.length || x >= state.editorGrid[0].length) {
      continue;
    }
    if (!sameColor(state.editorGrid[y][x], source)) continue;
    selected.add(key);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  state.editorSelectedCells = selected;
  state.editorLassoPoints = [];
  renderEditorCanvas();
  updateEditorControls();
}

function finalizeLassoSelection() {
  const points = state.editorLassoPoints;
  if (points.length < 3) {
    clearEditorSelection();
    renderEditorCanvas();
    updateEditorControls();
    return;
  }
  const selected = new Set();
  for (let y = 0; y < state.editorGrid.length; y += 1) {
    for (let x = 0; x < state.editorGrid[0].length; x += 1) {
      if (isPointInPolygon(x + 0.5, y + 0.5, points)) selected.add(`${x}:${y}`);
    }
  }
  state.editorSelectedCells = selected;
  renderEditorCanvas();
  updateEditorControls();
}

function isPointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    const intersects = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 0.0001) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function applyColorToEditorSelection() {
  if (!state.editorSelectedCells.size) return;
  recordEditorHistory();
  state.editorSelectedCells.forEach((key) => {
    const [x, y] = key.split(":").map(Number);
    if (state.editorGrid[y]?.[x] !== undefined) state.editorGrid[y][x] = cloneColor(state.selectedColor);
  });
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
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
  const cell = EDITOR_CELL_SIZE;
  const margin = EDITOR_MARGIN;
  canvas.width = columns * cell + margin * 2;
  canvas.height = rows * cell + margin * 2;

  context.fillStyle = "#fffdf7";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (state.editorReferenceImage) {
    context.save();
    context.globalAlpha = 0.24;
    context.drawImage(state.editorReferenceImage, margin, margin, columns * cell, rows * cell);
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
        if (state.editorPrefs.showCodes) {
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

  setEditorZoom(state.editorZoom);
}

function drawEditorSelectionOverlay(context, margin, cell) {
  const selection = state.editorSelection;
  context.save();
  context.fillStyle = "rgba(67, 94, 229, 0.14)";
  context.strokeStyle = "#435ee5";
  context.lineWidth = 3;
  context.setLineDash([8, 6]);
  if (selection) {
    const x0 = Math.min(selection.x0, selection.x1);
    const y0 = Math.min(selection.y0, selection.y1);
    const x1 = Math.max(selection.x0, selection.x1);
    const y1 = Math.max(selection.y0, selection.y1);
    context.fillRect(margin + x0 * cell, margin + y0 * cell, (x1 - x0 + 1) * cell, (y1 - y0 + 1) * cell);
    context.strokeRect(
      margin + x0 * cell + 1.5,
      margin + y0 * cell + 1.5,
      (x1 - x0 + 1) * cell - 3,
      (y1 - y0 + 1) * cell - 3,
    );
  }
  state.editorSelectedCells.forEach((key) => {
    const [x, y] = key.split(":").map(Number);
    context.fillRect(margin + x * cell, margin + y * cell, cell, cell);
    context.strokeRect(margin + x * cell + 2, margin + y * cell + 2, cell - 4, cell - 4);
  });
  if (state.editorLassoPoints.length) {
    context.beginPath();
    state.editorLassoPoints.forEach((point, index) => {
      const px = margin + point.x * cell;
      const py = margin + point.y * cell;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.stroke();
  }
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
  const nextColor = state.editorTool === "eraser" ? null : cloneColor(state.selectedColor);
  getSymmetryCells(column, row).forEach(({ x, y }) => {
    if (!sameColor(state.editorGrid[y][x], nextColor)) state.editorGrid[y][x] = cloneColor(nextColor);
  });
  renderEditorCanvas();
  updateReplaceOptions();
  updateEditorControls();
}

function getSymmetryCells(column, row) {
  const width = state.editorGrid[0]?.length || 0;
  const height = state.editorGrid.length;
  const cells = new Map([[`${column}:${row}`, { x: column, y: row }]]);
  if (state.editorSymmetry === "horizontal" || state.editorSymmetry === "both") {
    cells.set(`${width - 1 - column}:${row}`, { x: width - 1 - column, y: row });
  }
  if (state.editorSymmetry === "vertical" || state.editorSymmetry === "both") {
    cells.set(`${column}:${height - 1 - row}`, { x: column, y: height - 1 - row });
  }
  if (state.editorSymmetry === "both") {
    cells.set(`${width - 1 - column}:${height - 1 - row}`, {
      x: width - 1 - column,
      y: height - 1 - row,
    });
  }
  return [...cells.values()];
}

function undoPaint() {
  const action = state.paintUndo.pop();
  if (!action) return;
  state.editorGrid[action.y][action.x] = cloneColor(action.oldColor);
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
  els.undoPaintButton.disabled = state.editorHistory.length === 0;
  els.undoReplaceButton.disabled = state.editorHistory.length === 0;
  if (els.redoEditorButton) els.redoEditorButton.disabled = state.editorRedo.length === 0;
  if (els.applySelectionColorButton) els.applySelectionColorButton.disabled = state.editorSelectedCells.size === 0;
  els.replaceButton.disabled = !els.replaceFrom.value;
  updateLibraryImportButton();
}

function updateLibraryImportButton() {
  if (els.importLibraryButton) {
    els.importLibraryButton.disabled = !els.libraryImportSelect?.value;
  }
}

function applyFloatingPattern() {
  const floating = state.editorFloating;
  if (!floating) return;
  recordEditorHistory();
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
  recordEditorHistory();
  if (type === "flip-horizontal") {
    state.editorGrid = state.editorGrid.map((row) => row.slice().reverse().map(cloneColor));
  } else if (type === "flip-vertical") {
    state.editorGrid = state.editorGrid.slice().reverse().map((row) => row.map(cloneColor));
  } else if (type === "scale-down") {
    state.editorGrid = scaleGridNearest(state.editorGrid, 0.5);
  } else if (type === "scale-up") {
    state.editorGrid = scaleGridNearest(state.editorGrid, 2);
  } else if (type === "rotate-left") {
    const columns = oldGrid[0]?.length || 0;
    state.editorGrid = Array.from({ length: columns }, (_, y) =>
      Array.from({ length: oldGrid.length }, (_, x) => cloneColor(oldGrid[x][columns - 1 - y])),
    );
  } else if (type === "rotate-right") {
    const rows = oldGrid.length;
    state.editorGrid = Array.from({ length: oldGrid[0]?.length || 0 }, (_, y) =>
      Array.from({ length: rows }, (_, x) => cloneColor(oldGrid[rows - 1 - x][y])),
    );
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
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      state.editorReferenceImage = image;
      renderEditorCanvas();
      setStatus("已添加参考图");
    };
    image.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}

function clearEditorReferenceImage() {
  state.editorReferenceImage = null;
  if (els.referenceImageInput) els.referenceImageInput.value = "";
  renderEditorCanvas();
}

function trimEditorArtwork() {
  const bounds = getGridContentBounds(state.editorGrid);
  if (!bounds) return;
  const oldGrid = cloneGrid(state.editorGrid);
  recordEditorHistory();
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
  recordEditorHistory();
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
  recordEditorHistory();

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
  state.optimizationSummary = "";
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
  els.editorModal.close();
}

function saveEditorToLibrary() {
  state.grid = cloneGrid(state.editorGrid);
  state.optimizationSummary = "";
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

function createBlankBoard(options = {}) {
  const { openEditorAfterCreate = true } = options;
  const width = getGranularity();
  const height = getGridHeight();
  state.sourceDataUrl = "";
  state.sourceName = "blank-board";
  state.autoProcessAfterLoad = false;
  state.restoreAutoSizePending = false;
  state.backgroundDecision = "";
  state.sourceSafetyChecked = true;
  els.fileInput.value = "";
  els.sourcePreview.hidden = true;
  els.sourcePreview.removeAttribute("src");
  els.uploadZone.classList.remove("has-image", "drag-over");
  state.grid = Array.from({ length: height }, () => Array(width).fill(null));
  state.width = width;
  state.height = height;
  state.optimizationSummary = "";
  state.paletteLabel = getCurrentPaletteLabel();
  state.stats = [];
  state.assemblyHideCellText = false;
  refreshChartUrl();
  updateResultUi();
  setStatus("空白画板");
  if (openEditorAfterCreate) openEditor();
}

function resetAll() {
  state.sourceDataUrl = "";
  state.sourceName = "";
  state.autoProcessAfterLoad = false;
  state.restoreAutoSizePending = false;
  state.backgroundDecision = "";
  state.optimizationSummary = "";
  state.sourceAspectRatio = 1;
  state.ratioLocked = true;
  if (els.cropModeSelect) els.cropModeSelect.value = "cover";
  if (els.cropZoomInput) els.cropZoomInput.value = "100";
  if (els.cropXInput) els.cropXInput.value = "0";
  if (els.cropYInput) els.cropYInput.value = "0";
  updateCompositionUi();
  syncRangeControls("granularity", DEFAULT_GRANULARITY, MIN_GRANULARITY, MAX_GRANULARITY);
  updateRatioLockUi();
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
  state.stats = [];
  state.chartUrl = "";
  state.previewUrl = "";
  state.paletteLabel = "";
  state.backgroundDecision = "";
  state.optimizationSummary = "";
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

init();
