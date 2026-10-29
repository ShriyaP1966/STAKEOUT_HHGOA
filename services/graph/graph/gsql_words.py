"""GSQL words that cannot (or should not) be used as names in a query.

Copied from the TigerGraph 4.2 GSQL reference, page "Query Language Keywords & Reserved Words"
(https://www.tigergraph.com/docs/gsql-ref/4.2/appendix/query-language-reserved-words), read on 2026-10-30. Matching is case-insensitive:
the parser rejects `target`, `Target` and `TARGET` alike (this is what broke `VERTEX<Wallet> target` and the vertex set `Target`).
The page also lists C++ reserved words, which GSQL reserves too; of those only DEFAULT matters for the words checked here, and it is
avoided as well. tests/test_gsql_words.py uses these lists to check every name a query declares.
"""

RESERVED = frozenset("""
ACCUM AND ANY API AS ASC AVG BAG BATCH BETWEEN BOOL BOTH BREAK CASE CATCH COALESCE COMPRESS CONTINUE COUNT CREATE DATETIME DATETIME_ADD
DATETIME_SUB DELETE DESC DISTRIBUTED DO DOUBLE EDGE ELSE END ESCAPE EXCEPTION FALSE FILTER FLOAD FOR FOREACH FROM GRAPH HAVING IF IN INT
INTERPRET INTERSECT INTERVAL INTO IS ISEMPTY JSONARRAY JSONOBJECT LEADING LIKE LIMIT LOADACCUM MAX MIN MINUS NOT NULL OFFSET OR ORDER
PINNED POST_ACCUM PRIMARY_ID PRINT QUERY RAISE RANGE RETURN RETURNS RUN SAMPLE SELECT SELECTVERTEX SET STATIC STRING SUM SYNTAX TARGET
TAGS THEN TO TO_CSV TRAILING TRIM TRUE TRY TUPLE TYPEDEF UINT UNION VALUES VERTEX WHEN WHILE WITH GSQL_INT_MAX GSQL_INT_MIN
GSQL_UINT_MAX RESET_COLLECTION_ACCUM
""".split())

# allowed as names by the parser, but easy to trip over; the queries avoid them too
NON_RESERVED = frozenset("""
LIST MAP LOG NOW TO_DATETIME UPDATE FILE PER PATH REPLACE MATCH SRC TGT LASTHOP GROUP BY COMMIT ABORT DISTINCT INSERT DEFAULT
""".split())


def is_unsafe_name(name: str) -> bool:
    return name.upper() in RESERVED or name.upper() in NON_RESERVED
