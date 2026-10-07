"""Stage 1 tests: rubric registry and owner access control (in-memory, no network)."""

import json

CONTRACT = "contracts/preflight.py"


def canon(raw):
    """Address string exactly as the contract sees it (checksummed hex).

    The genlayer SDK is only importable after the first deploy has put the
    matching SDK version on sys.path, hence the lazy import.
    """
    from genlayer import Address

    return str(Address(raw))


def deploy(direct_vm, direct_deploy, owner, program="Portal: Intelligent Contracts", threshold=70):
    direct_vm.sender = owner
    return direct_deploy(CONTRACT, program, threshold)


def test_deploy_sets_defaults(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    assert c.get_program_name() == "Portal: Intelligent Contracts"
    assert c.get_rule_count() == 0
    assert c.get_rubric_version() == 1
    assert c.get_owner() == canon(direct_owner)


def test_empty_program_name_is_rejected(direct_vm, direct_deploy, direct_owner):
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("program_name must not be empty"):
        direct_deploy(CONTRACT, "   ", 70)


def test_owner_can_add_rules_and_version_increments(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    c.add_rule("Source code is readable and public", 30, 1)
    c.add_rule("README explains how consensus is used", 20, 0)
    assert c.get_rule_count() == 2
    assert c.get_rubric_version() == 3  # starts at 1, +1 per change


def test_non_owner_cannot_change_rubric(direct_vm, direct_deploy, direct_owner, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("only the program owner can do this"):
        c.add_rule("Sneaky rule", 10, 0)
    with direct_vm.expect_revert("only the program owner can do this"):
        c.transfer_ownership(canon(direct_alice))
    assert c.get_rule_count() == 0


def test_update_rule_and_soft_disable(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    c.add_rule("Has tests", 25, 1)
    c.update_rule(0, "Has automated tests", 0, 0)  # weight 0 = disabled
    rubric = json.loads(c.get_rubric_json())
    assert rubric["rules"][0]["text"] == "Has automated tests"
    assert rubric["rules"][0]["weight"] == 0
    assert rubric["rules"][0]["mandatory"] is False
    assert rubric["version"] == 3


def test_update_rule_out_of_range(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    with direct_vm.expect_revert("rule index out of range"):
        c.update_rule(0, "Nothing here yet", 10, 0)


def test_rule_validation(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    with direct_vm.expect_revert("rule text must not be empty"):
        c.add_rule("   ", 10, 0)
    with direct_vm.expect_revert("weight must be between 0 and 100"):
        c.add_rule("Valid text", 101, 0)
    with direct_vm.expect_revert("mandatory must be 0 or 1"):
        c.add_rule("Valid text", 10, 2)
    with direct_vm.expect_revert("rule text is too long"):
        c.add_rule("x" * 401, 10, 0)
    assert c.get_rule_count() == 0


def test_rubric_is_capped(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    for i in range(20):
        c.add_rule(f"Rule number {i}", 5, 0)
    with direct_vm.expect_revert("rubric is full"):
        c.add_rule("One too many", 5, 0)


def test_ownership_transfer(direct_vm, direct_deploy, direct_owner, direct_alice):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    # a lowercase hex input must be canonicalized, not stored verbatim
    c.transfer_ownership(canon(direct_alice).lower())
    assert c.get_owner() == canon(direct_alice)
    direct_vm.sender = direct_alice
    c.add_rule("Alice can edit now", 10, 0)
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("only the program owner can do this"):
        c.add_rule("Old owner is locked out", 10, 0)


def test_rubric_json_shape(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    c.add_rule("Mandatory rule", 40, 1)
    c.add_rule("Advisory rule", 10, 0)
    rubric = json.loads(c.get_rubric_json())
    assert rubric["program"] == "Portal: Intelligent Contracts"
    assert [r["id"] for r in rubric["rules"]] == [0, 1]
    assert rubric["rules"][0]["mandatory"] is True
    assert rubric["rules"][1]["mandatory"] is False


def test_transfer_to_invalid_address_is_rejected(direct_vm, direct_deploy, direct_owner):
    c = deploy(direct_vm, direct_deploy, direct_owner)
    with direct_vm.expect_revert("new_owner is not a valid address"):
        c.transfer_ownership("not-an-address")
    # the original owner keeps control
    c.add_rule("Still the owner", 10, 0)
