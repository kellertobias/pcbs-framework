import { SExpressionParser } from "./SExpressionParser";

const sample = [
    "kicad_sch",
    ["version", "20211123"],
    ["title_block",
        ["title", '"Project Name"'],
        ["company", '"My Company"']
    ],
    ["symbol",
        ["lib_id", '"Device:R"'],
        ["at", "0", "0", "0"]
    ]
];

const result = SExpressionParser.serialize(sample);
console.log(result);
