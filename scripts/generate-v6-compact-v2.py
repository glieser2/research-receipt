"""基于冻结的 V6 候选合约生成语义等价的 v2 压缩部署工件（仅剥离文档字符串与局部变量 α 重命名）。

保持全部模块级常量与函数名、ResearchReceipt 类全部属性与公私有方法名、全部公开方法参数名、
前两行 GenVM runner 元数据注释，以及全部非文档字符串字面量与 UTF-8 字节完全不变；
同时通过词法作用域 α 归一化 AST（含 type_comments）证明与原始候选合约同构。
"""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import io
import json
import keyword
from pathlib import Path
import platform
import string
import subprocess
import sys
import tokenize

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "contracts/research_receipt_v6_candidate.py"
OUTPUT = ROOT / "contracts/research_receipt_v6_compact_v2.py"
SOURCE_SHA256 = "9cff3a90a45daee031bf3fb893857bcb53cb07bc6501b86fecc955ce021b4a19"
ALGORITHM_TOOL = ROOT / "scripts/generate-compact-probe.py"
ALGORITHM_TOOL_SHA256 = "582aed2ebb3aa8551fc806fe44d28ab2920e242baee56266d83bbe545fd0ef04"
ALGORITHM = "python-ast-local-alpha-docstring-strip-minimal-whitespace/2"
BRADBURY_ESTIMABLE_SOURCE_CEILING_BYTES = 38895

IGNORED_TOKEN_TYPES = {
    tokenize.ENCODING,
    tokenize.NL,
    tokenize.NEWLINE,
    tokenize.INDENT,
    tokenize.DEDENT,
    tokenize.ENDMARKER,
}
ALPHABET_FIRST = string.ascii_letters
ALPHABET_NEXT = string.ascii_letters + string.digits
BASE_RESERVED = set(keyword.kwlist) | set(dir(__builtins__)) | {
    "gl",
    "self",
    "u32",
    "u256",
    "TreeMap",
    "DynArray",
    "Address",
    "hashlib",
    "json",
    "re",
    "date",
    "ResearchReceipt",
}


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def tree_dump(source):
    return ast.dump(ast.parse(source, type_comments=True), include_attributes=False)


def is_docstring_expr(body):
    return (
        bool(body)
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and type(body[0].value.value) is str
    )


def strip_docstrings_with_manifest(tree):
    """剥离模块、类与函数体首条文档字符串，并返回被剥离项的精确摘要清单。"""
    removed = []

    def strip_body(node, qualname):
        if is_docstring_expr(node.body):
            text = node.body[0].value.value
            encoded = text.encode("utf-8")
            removed.append(
                {
                    "qualname": qualname,
                    "sha256": sha256(encoded),
                    "utf8_byte_length": len(encoded),
                }
            )
            node.body = node.body[1:] or [ast.Pass()]

    def visit_scope(node, prefix):
        strip_body(node, prefix)
        for child in node.body:
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                qual = child.name if prefix == "<module>" else f"{prefix}.{child.name}"
                visit_scope(child, qual)
            elif isinstance(child, ast.ClassDef):
                qual = child.name if prefix == "<module>" else f"{prefix}.{child.name}"
                visit_scope(child, qual)

    visit_scope(tree, "<module>")
    return removed


def ordered_constants(source):
    """按 AST 遍历顺序提取全部 str/bytes 常量及其精确字节。"""
    result = []

    class Constants(ast.NodeVisitor):
        def visit_Constant(self, node):
            if type(node.value) is str:
                result.append(("str", node.value, node.value.encode("utf-8").hex()))
            elif type(node.value) is bytes:
                result.append(("bytes", node.value.hex(), node.value.hex()))

    Constants().visit(ast.parse(source, type_comments=True))
    return result


def ordered_non_docstring_constants(source):
    """剥离文档字符串后按 AST 顺序提取全部 str/bytes 常量及其精确字节。"""
    tree = ast.parse(source, type_comments=True)
    strip_docstrings_with_manifest(tree)
    result = []

    class Constants(ast.NodeVisitor):
        def visit_Constant(self, node):
            if type(node.value) is str:
                result.append(("str", node.value, node.value.encode("utf-8").hex()))
            elif type(node.value) is bytes:
                result.append(("bytes", node.value.hex(), node.value.hex()))

    Constants().visit(tree)
    return result


def is_public_contract_method(class_name, fn_node):
    if class_name != "ResearchReceipt":
        return False
    if fn_node.name == "__init__":
        return True
    return any("public" in ast.unparse(dec) for dec in fn_node.decorator_list)


def collect_target_names(target, sink):
    if isinstance(target, ast.Name):
        if target.id not in sink:
            sink.append(target.id)
    elif isinstance(target, (ast.Tuple, ast.List)):
        for elt in target.elts:
            collect_target_names(elt, sink)


def collect_function_local_bindings(fn_node, is_class_method=False, is_public_method=False):
    """按确定性 AST 顺序收集当前函数帧内的局部绑定名称（不跨入嵌套函数/推导式帧）。"""
    bound = []
    all_args = (
        list(fn_node.args.posonlyargs)
        + list(fn_node.args.args)
        + list(fn_node.args.kwonlyargs)
    )
    if fn_node.args.vararg:
        all_args.append(fn_node.args.vararg)
    if fn_node.args.kwarg:
        all_args.append(fn_node.args.kwarg)

    fixed_params = set()
    for index, arg in enumerate(all_args):
        if is_class_method and index == 0 and arg.arg == "self":
            fixed_params.add(arg.arg)
        elif is_public_method:
            fixed_params.add(arg.arg)
        else:
            if arg.arg not in bound:
                bound.append(arg.arg)

    class FrameVisitor(ast.NodeVisitor):
        def visit_FunctionDef(self, node):
            if node.name not in fixed_params and node.name not in bound:
                bound.append(node.name)
            for dec in node.decorator_list:
                self.visit(dec)
            for default in node.args.defaults:
                self.visit(default)
            for default in node.args.kw_defaults:
                if default is not None:
                    self.visit(default)
            for arg in (
                list(node.args.posonlyargs)
                + list(node.args.args)
                + list(node.args.kwonlyargs)
                + ([node.args.vararg] if node.args.vararg else [])
                + ([node.args.kwarg] if node.args.kwarg else [])
            ):
                if arg.annotation is not None:
                    self.visit(arg.annotation)
            if node.returns is not None:
                self.visit(node.returns)

        def visit_AsyncFunctionDef(self, node):
            self.visit_FunctionDef(node)

        def visit_ClassDef(self, node):
            if node.name not in fixed_params and node.name not in bound:
                bound.append(node.name)

        def visit_Lambda(self, node):
            for default in node.args.defaults:
                self.visit(default)
            for default in node.args.kw_defaults:
                if default is not None:
                    self.visit(default)

        def _visit_comprehension_outer(self, node):
            if node.generators:
                self.visit(node.generators[0].iter)

        def visit_ListComp(self, node):
            self._visit_comprehension_outer(node)

        def visit_SetComp(self, node):
            self._visit_comprehension_outer(node)

        def visit_DictComp(self, node):
            self._visit_comprehension_outer(node)

        def visit_GeneratorExp(self, node):
            self._visit_comprehension_outer(node)

        def visit_Assign(self, node):
            for target in node.targets:
                collect_target_names(target, bound)
            self.generic_visit(node)

        def visit_AnnAssign(self, node):
            collect_target_names(node.target, bound)
            self.generic_visit(node)

        def visit_AugAssign(self, node):
            collect_target_names(node.target, bound)
            self.generic_visit(node)

        def visit_For(self, node):
            collect_target_names(node.target, bound)
            self.generic_visit(node)

        def visit_ExceptHandler(self, node):
            if node.name and node.name not in fixed_params and node.name not in bound:
                bound.append(node.name)
            self.generic_visit(node)

    for stmt in fn_node.body:
        FrameVisitor().visit(stmt)
    bound = [name for name in bound if name not in fixed_params]
    return bound, fixed_params


def alpha_tree_dump(source):
    """剥离文档字符串后将全部词法局部绑定归一化为规范槽位名称并返回 AST dump。"""
    tree = ast.parse(source, type_comments=True)
    strip_docstrings_with_manifest(tree)

    def normalize_function(fn_node, env, depth, class_name=None):
        is_class_method = class_name is not None
        is_public = is_public_contract_method(class_name, fn_node)
        fn_node.decorator_list = [ExprNormalizer(env, depth).visit(d) for d in fn_node.decorator_list]
        fn_node.args.defaults = [ExprNormalizer(env, depth).visit(d) for d in fn_node.args.defaults]
        fn_node.args.kw_defaults = [
            ExprNormalizer(env, depth).visit(d) if d is not None else None
            for d in fn_node.args.kw_defaults
        ]
        for arg in (
            list(fn_node.args.posonlyargs)
            + list(fn_node.args.args)
            + list(fn_node.args.kwonlyargs)
            + ([fn_node.args.vararg] if fn_node.args.vararg else [])
            + ([fn_node.args.kwarg] if fn_node.args.kwarg else [])
        ):
            if arg.annotation is not None:
                arg.annotation = ExprNormalizer(env, depth).visit(arg.annotation)
        if fn_node.returns is not None:
            fn_node.returns = ExprNormalizer(env, depth).visit(fn_node.returns)

        bound, fixed_params = collect_function_local_bindings(
            fn_node, is_class_method=is_class_method, is_public_method=is_public
        )
        inner_env = dict(env)
        for fixed in fixed_params:
            inner_env[fixed] = f"__FIXED_PARAM_{fixed}__"
        for slot, name in enumerate(bound):
            inner_env[name] = f"__LOCAL_{depth}_{slot}__"

        for arg in (
            list(fn_node.args.posonlyargs)
            + list(fn_node.args.args)
            + list(fn_node.args.kwonlyargs)
            + ([fn_node.args.vararg] if fn_node.args.vararg else [])
            + ([fn_node.args.kwarg] if fn_node.args.kwarg else [])
        ):
            if arg.arg in inner_env:
                arg.arg = inner_env[arg.arg]

        fn_node.body = [ExprNormalizer(inner_env, depth + 1).visit(stmt) for stmt in fn_node.body]
        return fn_node

    class ExprNormalizer(ast.NodeTransformer):
        def __init__(self, env, depth):
            self.env = env
            self.depth = depth

        def visit_FunctionDef(self, node):
            if node.name in self.env:
                node.name = self.env[node.name]
            return normalize_function(node, self.env, self.depth, class_name=None)

        def visit_Lambda(self, node):
            node.args.defaults = [self.visit(d) for d in node.args.defaults]
            node.args.kw_defaults = [
                self.visit(d) if d is not None else None for d in node.args.kw_defaults
            ]
            sub_env = dict(self.env)
            all_args = (
                list(node.args.posonlyargs)
                + list(node.args.args)
                + list(node.args.kwonlyargs)
                + ([node.args.vararg] if node.args.vararg else [])
                + ([node.args.kwarg] if node.args.kwarg else [])
            )
            for slot, arg in enumerate(all_args):
                canon = f"__LAMBDA_{self.depth}_{slot}__"
                sub_env[arg.arg] = canon
                arg.arg = canon
            node.body = ExprNormalizer(sub_env, self.depth + 1).visit(node.body)
            return node

        def _visit_comp(self, node):
            comp_targets = []
            for gen in node.generators:
                collect_target_names(gen.target, comp_targets)
            sub_env = dict(self.env)
            for slot, name in enumerate(comp_targets):
                sub_env[name] = f"__COMP_{self.depth}_{slot}__"
            inner = ExprNormalizer(sub_env, self.depth + 1)
            for index, gen in enumerate(node.generators):
                gen.iter = self.visit(gen.iter) if index == 0 else inner.visit(gen.iter)
                gen.target = inner.visit(gen.target)
                gen.ifs = [inner.visit(cond) for cond in gen.ifs]
            if hasattr(node, "elt"):
                node.elt = inner.visit(node.elt)
            else:
                node.key = inner.visit(node.key)
                node.value = inner.visit(node.value)
            return node

        def visit_ListComp(self, node):
            return self._visit_comp(node)

        def visit_SetComp(self, node):
            return self._visit_comp(node)

        def visit_DictComp(self, node):
            return self._visit_comp(node)

        def visit_GeneratorExp(self, node):
            return self._visit_comp(node)

        def visit_ExceptHandler(self, node):
            if node.type is not None:
                node.type = self.visit(node.type)
            if node.name and node.name in self.env:
                node.name = self.env[node.name]
            node.body = [self.visit(stmt) for stmt in node.body]
            return node

        def visit_Name(self, node):
            if node.id in self.env:
                node.id = self.env[node.id]
            return node

    for top in tree.body:
        if isinstance(top, ast.FunctionDef):
            normalize_function(top, {}, 1, class_name=None)
        elif isinstance(top, ast.ClassDef):
            for item in top.body:
                if isinstance(item, ast.FunctionDef):
                    normalize_function(item, {}, 1, class_name=top.name)
        else:
            ExprNormalizer({}, 0).visit(top)

    return ast.dump(tree, include_attributes=False)


def short_names(excluded):
    for first in ALPHABET_FIRST:
        if first not in excluded:
            yield first
    for first in ALPHABET_FIRST:
        for second in ALPHABET_NEXT:
            candidate = first + second
            if candidate not in excluded:
                yield candidate


def pair_tokens(value):
    result = []
    reader = tokenize.generate_tokens(io.StringIO(value).readline)
    try:
        for token in reader:
            if token.type not in IGNORED_TOKEN_TYPES:
                result.append((token.type, token.string))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        pass
    return result


def emit_minimal_tokens(tree, runner_lines):
    unparsed = ast.unparse(tree)
    lines, line, previous, indent = [], "", None, 0
    for token in tokenize.generate_tokens(io.StringIO(unparsed).readline):
        kind, value = token.type, token.string
        if kind == tokenize.INDENT:
            if set(value) != {" "} or len(value) % 4:
                raise ValueError("Unexpected ast.unparse indentation")
            indent = len(value) // 4
        elif kind == tokenize.DEDENT:
            indent -= 1
        elif kind == tokenize.NEWLINE:
            if line:
                lines.append(line)
            line, previous = "", None
        elif kind not in {tokenize.NL, tokenize.ENDMARKER, tokenize.ENCODING, tokenize.COMMENT}:
            if not line:
                line = " " * indent
            needs_space = previous is not None and (
                previous[0] == tokenize.NUMBER and kind == tokenize.NAME
                or pair_tokens(previous[1] + value) != [previous, (kind, value)]
            )
            if needs_space:
                line += " "
            line += value
            previous = (kind, value)
    if line:
        lines.append(line)
    return b"".join(runner_lines) + ("\n".join(lines) + "\n").encode("utf-8")


def module_and_class_surface(source):
    """提取模块级导出符号与 ResearchReceipt 类成员签名，用于验证零表面漂移。"""
    tree = ast.parse(source, type_comments=True)
    module_symbols = []
    class_fields = []
    class_methods = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            module_symbols.append(("func", node.name, len(node.args.args)))
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    module_symbols.append(("const", target.id))
        elif isinstance(node, ast.ClassDef) and node.name == "ResearchReceipt":
            for item in node.body:
                if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                    class_fields.append((item.target.id, ast.unparse(item.annotation)))
                elif isinstance(item, ast.FunctionDef):
                    is_pub = is_public_contract_method("ResearchReceipt", item)
                    params = [arg.arg for arg in item.args.args]
                    class_methods.append(
                        (
                            item.name,
                            is_pub,
                            params if is_pub else [params[0], len(params) - 1],
                            [ast.unparse(dec) for dec in item.decorator_list],
                        )
                    )
    return {
        "module_symbols": module_symbols,
        "class_fields": class_fields,
        "class_methods": class_methods,
    }


def compact_source(raw):
    if sha256(raw) != SOURCE_SHA256:
        raise ValueError("Frozen V6 canonical source fingerprint mismatch")
    runner_lines = raw.splitlines(keepends=True)[:2]
    if (
        len(runner_lines) != 2
        or not runner_lines[0].startswith(b"# v0.3.0")
        or b"py-genlayer:" not in runner_lines[1]
    ):
        raise ValueError("Expected exact two runner metadata lines")

    original = raw.decode("utf-8")
    tree = ast.parse(original, type_comments=True)
    removed_docstrings = strip_docstrings_with_manifest(tree)
    if len(removed_docstrings) != 6:
        raise ValueError(f"Expected 6 docstrings in frozen V6 candidate, got {len(removed_docstrings)}")

    # 汇总模块级符号、公开方法名/参数名、存储字段名以及所有关键字实参名，禁止重命名触碰或遮蔽
    protected = set(BASE_RESERVED)
    called_keywords = {
        kw.arg
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        for kw in node.keywords
        if kw.arg is not None
    }
    protected |= called_keywords

    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            protected.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    protected.add(target.id)
        elif isinstance(node, ast.ClassDef):
            protected.add(node.name)
            for item in node.body:
                if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                    protected.add(item.target.id)
                elif isinstance(item, ast.FunctionDef):
                    protected.add(item.name)
                    if is_public_contract_method(node.name, item):
                        for arg in item.args.args:
                            protected.add(arg.arg)

    def subtree_referenced_names(node):
        return {sub.id for sub in ast.walk(node) if isinstance(sub, ast.Name)}

    def rewrite_function(fn_node, outer_map, class_name=None):
        is_class_method = class_name is not None
        is_public = is_public_contract_method(class_name, fn_node)
        outer_rewriter = ScopeRewriter(outer_map)
        fn_node.decorator_list = [outer_rewriter.visit(dec) for dec in fn_node.decorator_list]
        fn_node.args.defaults = [outer_rewriter.visit(default) for default in fn_node.args.defaults]
        fn_node.args.kw_defaults = [
            outer_rewriter.visit(default) if default is not None else None
            for default in fn_node.args.kw_defaults
        ]
        for arg in (
            list(fn_node.args.posonlyargs)
            + list(fn_node.args.args)
            + list(fn_node.args.kwonlyargs)
            + ([fn_node.args.vararg] if fn_node.args.vararg else [])
            + ([fn_node.args.kwarg] if fn_node.args.kwarg else [])
        ):
            if arg.annotation is not None:
                arg.annotation = outer_rewriter.visit(arg.annotation)
        if fn_node.returns is not None:
            fn_node.returns = outer_rewriter.visit(fn_node.returns)

        bound, fixed_params = collect_function_local_bindings(
            fn_node, is_class_method=is_class_method, is_public_method=is_public
        )
        referenced = subtree_referenced_names(fn_node)
        free_or_global = referenced - set(bound)
        kept_locals = {
            name for name in bound if name in called_keywords or len(name) <= 1
        } | fixed_params
        excluded = (
            set(protected)
            | free_or_global
            | set(outer_map.values())
            | kept_locals
        )
        allocator = short_names(excluded)
        local_map = dict(outer_map)
        for fixed in fixed_params:
            local_map[fixed] = fixed
        for kept in kept_locals:
            local_map[kept] = kept
        for name in bound:
            if name not in kept_locals:
                chosen = next(allocator)
                local_map[name] = chosen
                excluded.add(chosen)

        for arg in (
            list(fn_node.args.posonlyargs)
            + list(fn_node.args.args)
            + list(fn_node.args.kwonlyargs)
            + ([fn_node.args.vararg] if fn_node.args.vararg else [])
            + ([fn_node.args.kwarg] if fn_node.args.kwarg else [])
        ):
            if arg.arg in local_map:
                arg.arg = local_map[arg.arg]

        body_rewriter = ScopeRewriter(local_map, base_excluded=excluded)
        fn_node.body = [body_rewriter.visit(stmt) for stmt in fn_node.body]
        return fn_node

    class ScopeRewriter(ast.NodeTransformer):
        def __init__(self, scope_map, base_excluded=None):
            self.scope_map = dict(scope_map)
            self.base_excluded = set(base_excluded or protected)

        def visit_FunctionDef(self, node):
            if node.name in self.scope_map:
                node.name = self.scope_map[node.name]
            return rewrite_function(node, self.scope_map, class_name=None)

        def visit_Lambda(self, node):
            node.args.defaults = [self.visit(d) for d in node.args.defaults]
            node.args.kw_defaults = [
                self.visit(d) if d is not None else None for d in node.args.kw_defaults
            ]
            sub_map = dict(self.scope_map)
            referenced = subtree_referenced_names(node)
            lambda_args = [
                arg.arg
                for arg in (
                    list(node.args.posonlyargs)
                    + list(node.args.args)
                    + list(node.args.kwonlyargs)
                    + ([node.args.vararg] if node.args.vararg else [])
                    + ([node.args.kwarg] if node.args.kwarg else [])
                )
            ]
            kept = {name for name in lambda_args if len(name) <= 1}
            excluded = (
                self.base_excluded
                | (referenced - set(lambda_args))
                | set(sub_map.values())
                | kept
            )
            allocator = short_names(excluded)
            for arg in (
                list(node.args.posonlyargs)
                + list(node.args.args)
                + list(node.args.kwonlyargs)
                + ([node.args.vararg] if node.args.vararg else [])
                + ([node.args.kwarg] if node.args.kwarg else [])
            ):
                if arg.arg not in kept:
                    chosen = next(allocator)
                    sub_map[arg.arg] = chosen
                    arg.arg = chosen
                    excluded.add(chosen)
            node.body = ScopeRewriter(sub_map, base_excluded=excluded).visit(node.body)
            return node

        def _visit_comp(self, node):
            comp_targets = []
            for gen in node.generators:
                collect_target_names(gen.target, comp_targets)
            referenced = subtree_referenced_names(node)
            kept = {name for name in comp_targets if len(name) <= 1}
            sub_map = dict(self.scope_map)
            excluded = (
                self.base_excluded
                | (referenced - set(comp_targets))
                | set(sub_map.values())
                | kept
            )
            allocator = short_names(excluded)
            for name in comp_targets:
                if name in kept:
                    sub_map[name] = name
                else:
                    chosen = next(allocator)
                    sub_map[name] = chosen
                    excluded.add(chosen)
            inner = ScopeRewriter(sub_map, base_excluded=excluded)
            for index, gen in enumerate(node.generators):
                gen.iter = self.visit(gen.iter) if index == 0 else inner.visit(gen.iter)
                gen.target = inner.visit(gen.target)
                gen.ifs = [inner.visit(cond) for cond in gen.ifs]
            if hasattr(node, "elt"):
                node.elt = inner.visit(node.elt)
            else:
                node.key = inner.visit(node.key)
                node.value = inner.visit(node.value)
            return node

        def visit_ListComp(self, node):
            return self._visit_comp(node)

        def visit_SetComp(self, node):
            return self._visit_comp(node)

        def visit_DictComp(self, node):
            return self._visit_comp(node)

        def visit_GeneratorExp(self, node):
            return self._visit_comp(node)

        def visit_ExceptHandler(self, node):
            if node.type is not None:
                node.type = self.visit(node.type)
            if node.name and node.name in self.scope_map:
                node.name = self.scope_map[node.name]
            node.body = [self.visit(stmt) for stmt in node.body]
            return node

        def visit_Name(self, node):
            if node.id in self.scope_map:
                node.id = self.scope_map[node.id]
            return node

    for top in tree.body:
        if isinstance(top, ast.FunctionDef):
            rewrite_function(top, {}, class_name=None)
        elif isinstance(top, ast.ClassDef):
            for item in top.body:
                if isinstance(item, ast.FunctionDef):
                    rewrite_function(item, {}, class_name=top.name)

    ast.fix_missing_locations(tree)
    compact = emit_minimal_tokens(tree, runner_lines)
    compact_text = compact.decode("utf-8")

    # 多重静态等价性与安全不变量核验
    if alpha_tree_dump(original) != alpha_tree_dump(compact_text):
        raise ValueError("Alpha-normalized AST changed")
    if ordered_non_docstring_constants(original) != ordered_non_docstring_constants(compact_text):
        raise ValueError("Ordered non-docstring str/bytes values or UTF-8 bytes changed")
    if ordered_constants(compact_text) != ordered_non_docstring_constants(original):
        raise ValueError("Compact output still contains unexpected docstring constants")
    if strip_docstrings_with_manifest(ast.parse(compact_text, type_comments=True)) != []:
        raise ValueError("Expected zero remaining docstrings in compact_v2 output")
    if module_and_class_surface(original) != module_and_class_surface(compact_text):
        raise ValueError("Module-level symbols or ResearchReceipt surface drifted")
    if len(compact) >= BRADBURY_ESTIMABLE_SOURCE_CEILING_BYTES:
        raise ValueError(
            f"Compact v2 byte length {len(compact)} exceeds Bradbury ceiling {BRADBURY_ESTIMABLE_SOURCE_CEILING_BYTES}"
        )
    return compact


def source_dependency_check(raw):
    tree = ast.parse(raw.decode("utf-8"), type_comments=True)
    forbidden_names = {
        "__file__",
        "__name__",
        "__loader__",
        "__spec__",
        "inspect",
        "linecache",
        "traceback",
        "eval",
        "exec",
        "compile",
        "open",
    }
    forbidden_attributes = {
        "getsource",
        "getsourcelines",
        "currentframe",
        "f_lineno",
        "co_firstlineno",
        "__code__",
        "__traceback__",
    }
    hits = [
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name) and node.id in forbidden_names
    ]
    hits += [
        node.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute) and node.attr in forbidden_attributes
    ]
    hits += [
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.alias) and node.name.split(".")[0] in forbidden_names
    ]
    if hits:
        raise ValueError("Source/line/introspection dependency requires separate review: " + repr(hits))
    return {
        "source_line_introspection_dependency_hits": hits,
        "scope": "Static explicit name/import/attribute check, not a general runtime equivalence proof",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Run compact_v2 offline behavioral and AST equivalence test suite",
    )
    args = parser.parse_args()
    if sha256(ALGORITHM_TOOL.read_bytes()) != ALGORITHM_TOOL_SHA256:
        raise ValueError("Frozen v1 token-emitter dependency mismatch")
    raw = SOURCE.read_bytes()
    dependencies = source_dependency_check(raw)
    compact = compact_source(raw)

    # 确定性重复运行允许完全一致的字节；若已有不同字节则严禁覆盖
    if OUTPUT.exists():
        if OUTPUT.read_bytes() != compact:
            raise ValueError("Existing compact_v2 artifact differs; refuse overwrite")
    else:
        with OUTPUT.open("xb") as file:
            file.write(compact)

    verification = {"executed": False, "reason": "Use --verify for artifact-specific offline tests"}
    if args.verify:
        logical_command = [
            "python",
            "-m",
            "unittest",
            "discover",
            "-s",
            "tests/python",
            "-p",
            "test_v6_compact_v2.py",
        ]
        exec_command = [sys.executable, *logical_command[1:]]
        result = subprocess.run(
            exec_command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8"
        )
        verification = {
            "executed": True,
            "command": logical_command,
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "scope": "Offline stubs only; no real model, RPC, signature, or consensus proof",
        }

    original_text = raw.decode("utf-8")
    compact_text = compact.decode("utf-8")
    stripped_manifest = strip_docstrings_with_manifest(ast.parse(original_text, type_comments=True))
    non_doc_constants = ordered_non_docstring_constants(original_text)
    tool = Path(__file__).resolve()
    report = {
        "algorithm": ALGORITHM,
        "python_version": sys.version,
        "python_implementation": platform.python_implementation(),
        "source_file": SOURCE.relative_to(ROOT).as_posix(),
        "source_sha256": sha256(raw),
        "tool_file": tool.relative_to(ROOT).as_posix(),
        "tool_sha256": sha256(tool.read_bytes()),
        "algorithm_dependency_file": ALGORITHM_TOOL.relative_to(ROOT).as_posix(),
        "algorithm_dependency_sha256": ALGORITHM_TOOL_SHA256,
        "artifact_test_file": "tests/python/test_v6_compact_v2.py",
        "artifact_test_sha256": sha256((ROOT / "tests/python/test_v6_compact_v2.py").read_bytes()),
        "output_file": OUTPUT.relative_to(ROOT).as_posix(),
        "output_sha256": sha256(compact),
        "source_bytes": len(raw),
        "output_bytes": len(compact),
        "bradbury_estimable_ceiling_bytes": BRADBURY_ESTIMABLE_SOURCE_CEILING_BYTES,
        "runner_first_two_lines_bytes_identical": (
            compact.splitlines(keepends=True)[:2] == raw.splitlines(keepends=True)[:2]
        ),
        "full_ast_type_comments_equal": tree_dump(original_text) == tree_dump(compact_text),
        "alpha_normalized_ast_type_comments_equal": (
            alpha_tree_dump(original_text) == alpha_tree_dump(compact_text)
        ),
        "ordered_str_bytes_values_and_utf8_bytes_equal": (
            ordered_constants(original_text) == ordered_constants(compact_text)
        ),
        "ordered_non_docstring_str_bytes_values_and_utf8_bytes_equal": (
            non_doc_constants == ordered_non_docstring_constants(compact_text)
            and non_doc_constants == ordered_constants(compact_text)
        ),
        "module_and_class_surface_identical": (
            module_and_class_surface(original_text) == module_and_class_surface(compact_text)
        ),
        "stripped_docstring_count": len(stripped_manifest),
        "stripped_docstrings": stripped_manifest,
        "output_docstring_count": len(
            strip_docstrings_with_manifest(ast.parse(compact_text, type_comments=True))
        ),
        "alpha_ast_sha256": sha256(alpha_tree_dump(original_text).encode("utf-8")),
        "ordered_non_docstring_constants_sha256": sha256(
            json.dumps(non_doc_constants, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ),
        "dependency_check": dependencies,
        "verification": verification,
        "original_verbatim_source_assertion": (
            "INAPPLICABLE to compact_v2 formatting; replaced by lexical-scope alpha-normalized AST, "
            "ordered non-docstring constants, identical module/class surface, and behavioral equivalence tests"
        ),
        "no_transport_success_claim": True,
    }
    directory = ROOT / "artifacts/v6-compact-builds"
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    report_path = directory / (stamp + "-" + report["output_sha256"][:12] + ".json")
    serialized_report = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    with report_path.open("x", encoding="utf-8", newline="\n") as file:
        file.write(serialized_report)
    fixture_report = ROOT / "tests/fixtures/v6-compact-v2-build.json"
    if not fixture_report.exists():
        with fixture_report.open("x", encoding="utf-8", newline="\n") as file:
            file.write(serialized_report)
    print(
        json.dumps(
            {
                key: report[key]
                for key in (
                    "algorithm",
                    "source_sha256",
                    "tool_sha256",
                    "output_sha256",
                    "source_bytes",
                    "output_bytes",
                    "alpha_normalized_ast_type_comments_equal",
                )
            },
            sort_keys=True,
        )
    )
    print("report=" + report_path.relative_to(ROOT).as_posix())
    if args.verify and verification["exit_code"]:
        raise SystemExit(verification["exit_code"])


if __name__ == "__main__":
    main()
