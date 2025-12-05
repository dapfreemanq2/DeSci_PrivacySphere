pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DeSciPrivacySphereFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public batchClosed;
    mapping(uint256 => euint32) public encryptedSum; // Stores the encrypted sum for a batch
    mapping(uint256 => uint256) public encryptedCount; // Stores the count of submissions for a batch (plaintext)

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event DataSubmitted(address indexed provider, uint256 indexed batchId, bytes32 encryptedData);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint32 decryptedSum, uint256 count);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosedOrInvalid();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidBatchId();
    error NotInitialized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        currentBatchId = 1; // Start with batch 1
        emit BatchOpened(currentBatchId);
        cooldownSeconds = 60; // Default cooldown
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert Paused(); // Revert if already unpaused
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openNewBatch() external onlyOwner {
        currentBatchId++;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner {
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatchId();
        if (batchClosed[batchId]) revert BatchClosedOrInvalid(); // Already closed
        batchClosed[batchId] = true;
        emit BatchClosed(batchId);
    }

    function submitEncryptedData(uint256 batchId, bytes32 encryptedData) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (batchId == 0 || batchId > currentBatchId || batchClosed[batchId]) {
            revert BatchClosedOrInvalid();
        }

        euint32 memory submittedValue = FHE.asEuint32(encryptedData);
        _initIfNeeded(batchId);

        encryptedSum[batchId] = encryptedSum[batchId].add(submittedValue);
        encryptedCount[batchId]++;

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit DataSubmitted(msg.sender, batchId, encryptedData);
    }

    function requestBatchResultDecryption(uint256 batchId) external onlyProvider whenNotPaused {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (batchId == 0 || batchId > currentBatchId || !batchClosed[batchId]) {
            revert BatchClosedOrInvalid(); // Must be a valid, closed batch
        }
        if (!FHE.isInitialized(encryptedSum[batchId])) revert NotInitialized();

        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedSum[batchId]);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        emit DecryptionRequested(requestId, batchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay guard prevents processing the same decryption request multiple times.

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedSum[decryptionContexts[requestId].batchId]);
        bytes32 currentHash = _hashCiphertexts(cts);

        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();
        // Security: State verification ensures the ciphertexts that were decrypted match the
        // ciphertexts currently in contract storage. This prevents scenarios where ciphertexts
        // might have changed after the decryption was requested but before the callback was processed.

        FHE.checkSignatures(requestId, cleartexts, proof);

        (uint32 decryptedSum) = abi.decode(cleartexts, (uint32));
        uint256 batchId = decryptionContexts[requestId].batchId;
        uint256 count = encryptedCount[batchId];

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, decryptedSum, count);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(uint256 batchId) internal {
        if (!FHE.isInitialized(encryptedSum[batchId])) {
            encryptedSum[batchId] = FHE.asEuint32(0);
            encryptedCount[batchId] = 0;
        }
    }

    function _requireInitialized(euint32 x) internal pure {
        if (!FHE.isInitialized(x)) revert NotInitialized();
    }
}